import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const telemetrySrcIndex = fileURLToPath(new URL("../pi-telemetry/src/index.ts", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../pi-ai/src/index.ts", import.meta.url));
const aiSrcCompat = fileURLToPath(new URL("../pi-ai/src/compat.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		include: ["test/harness/**/*.test.ts"],
		coverage: {
			provider: "v8",
			all: true,
			include: ["src/harness/**/*.ts", "src/agent.ts", "src/agent-loop.ts"],
			exclude: ["src/**/*.d.ts"],
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "coverage/harness",
		},
	},
	resolve: {
		alias: [
			{ find: /^@pilore\/pi-telemetry$/, replacement: telemetrySrcIndex },
			{ find: /^@pilore\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@pilore\/pi-ai$/, replacement: aiSrcIndex },
			{ find: /^@pilore\/pi-ai\/compat$/, replacement: aiSrcCompat },
		],
	},
});
