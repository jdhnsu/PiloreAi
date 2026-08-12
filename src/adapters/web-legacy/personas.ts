/**
 * 教学方法（persona）登记与解析。
 *
 * 设计文档（agent-design/*.md）即「老师」注册表：frontmatter 提供路由目录
 * 条目（name/description）与环境契约（capabilities deny-list），正文是该老师的
 * 教学 prompt。新增老师 = 放一个带 frontmatter 的 md 文件，或用自定义
 * Persona 集合注入 createAgent/createEduSession。
 *
 * 本模块 import 时不做任何磁盘读取：默认集合经 getDefaultPersonas() 首次调用时
 * 才扫描 agent-design/（懒加载、进程内记忆化）；嵌入项目可用 loadPersonasFromDir()
 * 或 parsePersona() 构造自定义集合。
 */
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

/**
 * 环境契约：deny-list，只列禁止项，省略 = 允许。
 * 能力词汇与运行时工具解耦，由运行时把能力映射到自己的工具：
 *   file.read   → read_file
 *   file.write  → write_file（新建文件）
 *   file.modify → write_file（覆盖已有文件）
 *   file.list   → （未来 list_files）
 *   exec.run    → run_code
 *   （未来可扩展 web.fetch / web.search ...）
 */
export type PersonaCapabilities = Record<string, "allow" | "deny">;

/** frontmatter 元数据：路由目录与权限契约的来源（单一事实源）。 */
export interface PersonaMeta {
	name: string;
	/** 路由目录条目：何时用 / 触发词 / 用法示例，路由器只依据它判断 */
	description: string;
	/** 本期无语义，预留给未来（如 manual = 仅 @ 指定） */
	mode: string;
	capabilities: PersonaCapabilities;
}

export interface Persona {
	key: PersonaKey;
	name: string;
	file: string;
	/** 设计文档正文（去掉 YAML frontmatter），即该老师的教学 prompt */
	prompt: string;
	meta: PersonaMeta;
}

/** persona 标识（设计文档文件名去 .md 后缀、小写化），如 "socrates" / "oris" */
export type PersonaKey = string;

// agent-design/ 在 src 上一级，用 import.meta.url 定位以免受 cwd 影响
const DESIGN_DIR = new URL("../../packs/code/agent-design/profiles/", import.meta.url);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function fail(file: string, msg: string): never {
	throw new Error(`agent-design/${file}: ${msg}`);
}

/**
 * 从设计文档源码解析一个 Persona（纯函数，不碰磁盘）。
 * 嵌入项目可用它从任意来源（数据库/远程配置/内嵌字符串）构造老师。
 * `fileName` 用于报错定位与派生 key（去 .md 后缀、小写化）。
 */
export function parsePersona(source: string, fileName: string): Persona {
	const match = source.match(FRONTMATTER_RE);
	if (!match) fail(fileName, "缺少 frontmatter（必须以 --- 开头）");

	const meta = parse(match[1]) as Record<string, unknown>;
	const name = typeof meta.name === "string" && meta.name ? meta.name : fail(fileName, "frontmatter 缺少 name");
	const description =
		typeof meta.description === "string" && meta.description ? meta.description : fail(fileName, "frontmatter 缺少 description");
	const mode = typeof meta.mode === "string" && meta.mode ? meta.mode : "primary";

	const capabilities: PersonaCapabilities = {};
	if (meta.capabilities != null) {
		if (typeof meta.capabilities !== "object" || Array.isArray(meta.capabilities)) {
			fail(fileName, "capabilities 必须是映射（如 file.modify: deny）");
		}
		for (const [cap, value] of Object.entries(meta.capabilities as Record<string, unknown>)) {
			if (value !== "allow" && value !== "deny") fail(fileName, `capabilities.${cap} 必须为 allow 或 deny，实际为 ${String(value)}`);
			capabilities[cap] = value;
		}
	}

	const body = source.slice(match[0].length).trim();
	if (!body) fail(fileName, "文档正文为空");
	const key = fileName.replace(/\.md$/, "").toLowerCase();
	return { key, name, file: fileName, prompt: body, meta: { name, description, mode, capabilities } };
}

/** 扫描目录下全部 *.md 设计文档并解析（按文件名排序）。 */
export function loadPersonasFromDir(dir: URL | string = DESIGN_DIR): Persona[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => parsePersona(readFileSync(new URL(f, dir), "utf8"), f));
}

let defaultPersonas: Persona[] | undefined;

/**
 * 内置默认老师集合（懒加载 + 进程内记忆化）：首次调用时才扫描 agent-design/。
 * 注意：目录缺失或文档非法会在这里抛错，而不是在 import 时。
 */
export function getDefaultPersonas(): Persona[] {
	if (!defaultPersonas) defaultPersonas = loadPersonasFromDir();
	return defaultPersonas;
}

/** 老师 key 列表（用于 adopt_persona 参数 schema 与提示文案）。 */
export function getPersonaKeys(personas: Persona[] = getDefaultPersonas()): string[] {
	return personas.map((p) => p.key);
}

export function getPersona(key: string, personas: Persona[] = getDefaultPersonas()): Persona | undefined {
	return personas.find((p) => p.key === key);
}

/** 由 frontmatter 的 name+description 生成路由目录（路由器唯一依据，单一事实源）。 */
export function buildCatalog(personas: Persona[] = getDefaultPersonas()): string {
	return personas.map((p) => `- @${p.key}（${p.meta.name}）：${p.meta.description}`).join("\n");
}

export function availablePersonasText(personas: Persona[] = getDefaultPersonas()): string {
	return personas.map((p) => `@${p.key}`).join(" / ");
}

/**
 * 解析 "@老师 问题" 前缀；无 @ 返回 undefined，@ 无效或缺问题则抛错。
 * persona 为 null 表示 @pilore：切回自动路由。
 */
export function resolveMention(
	text: string,
	personas: Persona[] = getDefaultPersonas(),
): { persona: Persona | null; rest: string } | undefined {
	const match = text.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)/);
	if (!match) return undefined;
	const key = match[1].toLowerCase();
	const rest = text.slice(match[0].length).trim();
	if (!rest) throw new Error(`请在 @${key} 后面写下你的问题`);
	if (key === "pilore") return { persona: null, rest };
	const persona = getPersona(key, personas);
	if (!persona) throw new Error(`没有这位老师: @${match[1]}（可用: ${availablePersonasText(personas)} / @pilore）`);
	return { persona, rest };
}
