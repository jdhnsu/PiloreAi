import "dotenv/config";
import type { AddressInfo } from "node:net";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createCodeMentorSession, type SessionEvent } from "../src/index.js";
import { createMockExecServer } from "../mock/exec-server.js";

function render(event: SessionEvent): void {
	if (event.type === "text_delta") process.stdout.write(event.delta);
	else if (event.type === "tool_start") console.log(`\n[工具] ${event.toolName}`);
	else if (event.type === "tool_end") console.log(`[${event.isError ? "错误" : "结果"}] ${event.text}`);
	else if (event.type === "toolset") console.log(`[工具组] ${event.toolset} 已加载`);
}

async function main(): Promise<void> {
	const server = createMockExecServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	process.env.EXEC_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const code = ['print("斐波那契数列前 10 项:")', 'print("0 1 1 2 3 5 8 13 21 34")', ""].join("\n");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "workspace" })]),
		fauxAssistantMessage([fauxToolCall("write_file", { path: "fib.py", content: code })]),
		fauxAssistantMessage([fauxToolCall("activate_toolset", { toolset: "execution" })]),
		fauxAssistantMessage([fauxToolCall("run_code", { sandbox: "python", entry: "fib.py" })]),
		fauxAssistantMessage([fauxText("运行成功。下一步可以把写死的结果改成循环计算。")]),
	]);

	try {
		const session = createCodeMentorSession({ models, providerId: "faux", modelId: "faux-1" });
		await session.prompt("写一个打印斐波那契数列前 10 项的 Python 程序并运行", render);
		console.log(`\n[demo] 文件: ${session.listFiles().join(", ")}`);
	} finally {
		server.close();
	}
}

await main();
