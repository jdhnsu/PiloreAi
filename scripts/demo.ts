import "dotenv/config";
import type { AddressInfo } from "node:net";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { createAgent } from "../src/agent.js";
import { attachConsoleRenderer } from "../src/render.js";
import { createMockExecServer } from "../mock/exec-server.js";

/**
 * 无需 API key 的链路演示：
 * fauxProvider 脚本化 "write_file → run_code → 总结" 三段回复，
 * 进程内启动 mock 执行服务，验证工具调度与事件渲染完整可用。
 */
async function main(): Promise<void> {
	const server = createMockExecServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	process.env.EXEC_API_BASE = `http://127.0.0.1:${port}`;
	console.log(`[demo] mock 执行服务已启动: ${process.env.EXEC_API_BASE}`);

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);

	const fibCode = ['print("斐波那契数列前 10 项:")', 'print("0 1 1 2 3 5 8 13 21 34")', ""].join("\n");

	faux.setResponses([
		fauxAssistantMessage(
			[
				fauxText("好！我们先把程序写出来。斐波那契数列的规则是：从第三项起，每一项等于前两项之和。\n"),
				fauxToolCall("write_file", { path: "fib.py", content: fibCode }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxText("文件写好了，现在提交到沙箱运行，看看真实输出：\n"),
				fauxToolCall("run_code", { sandbox: "python", command: "run" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			"运行成功！程序先打印了标题，再打印数列本身，和预期一致。\n\n讲解：第一行 print 输出说明文字；第二行输出计算好的前 10 项。下一步练习：试着修改代码，让程序自己用循环算出这 10 项，而不是写死结果。",
			{ stopReason: "stop" },
		),
	]);

	const { agent } = createAgent({ models, providerId: "faux", modelId: "faux-1" });
	attachConsoleRenderer(agent);

	const question = "写一个打印斐波那契数列前 10 项的 Python 程序并运行给我看";
	console.log(`[demo] 用户提问: ${question}\n`);
	await agent.prompt(question);
	await agent.waitForIdle();

	server.close();
	console.log("\n[demo] 链路验证完成：write_file → run_code → 总结讲解 ✓");
	process.exit(0);
}

main().catch((err) => {
	console.error("[demo] 失败:", err);
	process.exit(1);
});
