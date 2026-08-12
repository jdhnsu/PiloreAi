/** 无网络、无默认 Profile 目录依赖的最小 Code Pack 嵌入示例。 */
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createCodeMentorSession,
	parseCodeProfile,
	VirtualFS,
	type ExecClient,
	type SessionEvent,
} from "../src/index.js";

const guide = parseCodeProfile(
	[
		"---",
		"name: Guide",
		"description: 用类比讲清抽象概念。",
		"capabilities:",
		"  file.modify: deny",
		"---",
		"先给一个生活化类比，再用最小代码验证。",
	].join("\n"),
	"guide.md",
);

const exec: ExecClient = {
	exec: async (request) => ({
		id: "embed:1",
		ok: true,
		duration: 1,
		stdout: `(embed 沙箱) ${request.sandbox}: ${Object.keys(request.files).length} file(s)`,
		stderr: "",
	}),
};

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "execution" })]),
	fauxAssistantMessage([fauxToolCall("run_code", { sandbox: "python", entry: "demo.py" })]),
	fauxAssistantMessage("闭包像背包：函数离开定义位置后，仍带着当时捕获的变量。"),
]);

const vfs = new VirtualFS();
vfs.write("demo.py", "print('hello')");
const session = createCodeMentorSession({ models, providerId: "faux", modelId: "faux-1", profiles: [guide], exec, vfs });
const render = (event: SessionEvent): void => {
	if (event.type === "text_delta") process.stdout.write(event.delta);
	else if (event.type === "profile") console.log(`\n[Profile] ${event.profile ?? "auto"}`);
	else if (event.type === "tool_end") console.log(`\n[Tool] ${event.text}`);
};

await session.prompt("@guide 什么是闭包？", render);
console.log(`\n文件: ${session.listFiles().join(", ")}`);
