import { readFileSync } from "node:fs";

export interface Persona {
	key: string;
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
