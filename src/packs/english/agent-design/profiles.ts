import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import type { ProfileDefinition } from "../../../core/types.js";
const DEFAULT_DIR = new URL("./profiles/", import.meta.url); const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
export function parseEnglishProfile(source: string, fileName: string): ProfileDefinition {
	const match = source.match(FRONTMATTER); if (!match) throw new Error(`${fileName}: 缺少 frontmatter`); const meta = parse(match[1]) as Record<string, unknown>; const name = typeof meta.name === "string" ? meta.name : ""; const description = typeof meta.description === "string" ? meta.description : ""; if (!name || !description) throw new Error(`${fileName}: 缺少 name/description`);
	const capabilities: Record<string, "allow" | "deny"> = {}; if (meta.capabilities !== undefined) { if (!meta.capabilities || typeof meta.capabilities !== "object" || Array.isArray(meta.capabilities)) throw new Error(`${fileName}: capabilities 非法`); for (const [key, value] of Object.entries(meta.capabilities as Record<string, unknown>)) { if (value !== "allow" && value !== "deny") throw new Error(`${fileName}: capabilities.${key} 非法`); capabilities[key] = value; } }
	const methodology = source.slice(match[0].length).trim(); if (!methodology) throw new Error(`${fileName}: 方法论为空`); return { key: fileName.replace(/\.md$/i, "").toLowerCase(), name, description, methodology, capabilities };
}
export function loadEnglishProfiles(dir: URL | string = DEFAULT_DIR): ProfileDefinition[] { return readdirSync(dir).filter((file) => file.endsWith(".md")).sort().map((file) => parseEnglishProfile(readFileSync(new URL(file, dir), "utf8"), file)); }
let defaults: ProfileDefinition[] | undefined; export function getDefaultEnglishProfiles(): ProfileDefinition[] { return defaults ??= loadEnglishProfiles(); }
