import { readFileSync } from "node:fs";

export interface Persona {
	key: PersonaKey;
	name: string;
	file: string;
	/** 设计文档正文（去掉 YAML frontmatter），即该老师的教学 prompt */
	prompt: string;
}

// agent-design/ 在 edu-agent 上一级，用 import.meta.url 定位以免受 cwd 影响
const DESIGN_DIR = new URL("../../agent-design/", import.meta.url);

function loadBody(file: string): string {
	const raw = readFileSync(new URL(file, DESIGN_DIR), "utf8");
	const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
}

export const PERSONA_KEYS = ["feynman", "socrates", "oris"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

/** 新增老师：在 agent-design/ 放设计文档，并在此登记一行。 */
export const PERSONAS: Persona[] = [
	{ key: "feynman", name: "Feynman", file: "feynman.md", prompt: loadBody("feynman.md") },
	{ key: "socrates", name: "Socrates", file: "socrates.md", prompt: loadBody("socrates.md") },
	{ key: "oris", name: "Oris", file: "Oris.md", prompt: loadBody("Oris.md") },
];

export function getPersona(key: string): Persona | undefined {
	return PERSONAS.find((p) => p.key === key);
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
	if (!persona) throw new Error(`没有这位老师: @${match[1]}（可用: @feynman / @socrates / @oris / @pilore）`);
	return { persona, rest };
}
