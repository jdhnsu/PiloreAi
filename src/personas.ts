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

// agent-design/ 在 src 上一级，用 import.meta.url 定位以免受 cwd 影响
const DESIGN_DIR = new URL("../agent-design/", import.meta.url);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function fail(file: string, msg: string): never {
	throw new Error(`agent-design/${file}: ${msg}`);
}

function parsePersona(file: string): Persona {
	const raw = readFileSync(new URL(file, DESIGN_DIR), "utf8");
	const match = raw.match(FRONTMATTER_RE);
	if (!match) fail(file, "缺少 frontmatter（必须以 --- 开头）");

	const meta = parse(match[1]) as Record<string, unknown>;
	const name = typeof meta.name === "string" && meta.name ? meta.name : fail(file, "frontmatter 缺少 name");
	const description =
		typeof meta.description === "string" && meta.description ? meta.description : fail(file, "frontmatter 缺少 description");
	const mode = typeof meta.mode === "string" && meta.mode ? meta.mode : "primary";

	const capabilities: PersonaCapabilities = {};
	if (meta.capabilities != null) {
		if (typeof meta.capabilities !== "object" || Array.isArray(meta.capabilities)) {
			fail(file, "capabilities 必须是映射（如 file.modify: deny）");
		}
		for (const [cap, value] of Object.entries(meta.capabilities as Record<string, unknown>)) {
			if (value !== "allow" && value !== "deny") fail(file, `capabilities.${cap} 必须为 allow 或 deny，实际为 ${String(value)}`);
			capabilities[cap] = value;
		}
	}

	const body = raw.slice(match[0].length).trim();
	if (!body) fail(file, "文档正文为空");
	const key = file.replace(/\.md$/, "").toLowerCase();
	return { key, name, file, prompt: body, meta: { name, description, mode, capabilities } };
}

/** 新增老师：在 agent-design/ 放一个带 frontmatter 的设计文档即可，无需改代码。 */
export const PERSONAS: Persona[] = readdirSync(DESIGN_DIR)
	.filter((f) => f.endsWith(".md"))
	.sort()
	.map(parsePersona);

export const PERSONA_KEYS: string[] = PERSONAS.map((p) => p.key);
export type PersonaKey = string;

export function getPersona(key: string): Persona | undefined {
	return PERSONAS.find((p) => p.key === key);
}

/** 由 frontmatter 的 name+description 生成路由目录（路由器唯一依据，单一事实源）。 */
export function buildCatalog(): string {
	return PERSONAS.map((p) => `- @${p.key}（${p.meta.name}）：${p.meta.description}`).join("\n");
}

export function availablePersonasText(): string {
	return PERSONAS.map((p) => `@${p.key}`).join(" / ");
}

/**
 * 解析 "@老师 问题" 前缀；无 @ 返回 undefined，@ 无效或缺问题则抛错。
 * persona 为 null 表示 @pilore：切回自动路由。
 */
export function resolveMention(text: string): { persona: Persona | null; rest: string } | undefined {
	const match = text.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)/);
	if (!match) return undefined;
	const key = match[1].toLowerCase();
	const rest = text.slice(match[0].length).trim();
	if (!rest) throw new Error(`请在 @${key} 后面写下你的问题`);
	if (key === "pilore") return { persona: null, rest };
	const persona = getPersona(key);
	if (!persona) throw new Error(`没有这位老师: @${match[1]}（可用: ${availablePersonasText()} / @pilore）`);
	return { persona, rest };
}
