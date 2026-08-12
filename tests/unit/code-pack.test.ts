import assert from "node:assert/strict";
import test from "node:test";
import { CoreState, createCodeToolManifest, getDefaultCodeProfiles, toolsForState } from "../../src/index.js";
import { VirtualFS } from "../../src/packs/code/vfs.js";

test("Code Pack owns its three default profiles", () => {
	assert.deepEqual(getDefaultCodeProfiles().map((profile) => profile.key), ["feynman", "oris", "socrates"]);
});

test("Code tools are absent until their toolsets are activated", () => {
	const state = new CoreState();
	const manifest = createCodeToolManifest(new VirtualFS(), { exec: async () => ({ id: "x", ok: true, duration: 0, stdout: "", stderr: "" }) });
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), []);
	state.activateToolset("workspace");
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), ["write_file", "read_file"]);
	state.activateToolset("execution");
	assert.deepEqual(toolsForState(manifest, state, []).map((tool) => tool.name), ["write_file", "read_file", "run_code"]);
});
