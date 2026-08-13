import type { ProfileDefinition } from "../../../core/types.js";
import { loadAcademicProfiles, parseAcademicProfile } from "../../shared/academic/profile-loader.js";

const DEFAULT_DIR = new URL("./profiles/", import.meta.url);

export function parseMathProfile(source: string, fileName: string): ProfileDefinition {
	return parseAcademicProfile(source, fileName);
}

export function loadMathProfiles(dir: URL | string = DEFAULT_DIR): ProfileDefinition[] {
	return loadAcademicProfiles(dir);
}

let defaults: ProfileDefinition[] | undefined;
export function getDefaultMathProfiles(): ProfileDefinition[] {
	return defaults ??= loadMathProfiles();
}
