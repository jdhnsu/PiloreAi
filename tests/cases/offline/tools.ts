// 离线用例之二:工具契约(见 TEST-SPEC OTL-01..04)。
// 全部用 faux 脚本驱动真实工具执行,evidence 反映「实际执行的工具序列与结果」。
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { runFauxCase } from "../../harness/faux-driver.js";
import type { OfflineCaseDef } from "../../harness/score.js";

export const toolsCases: OfflineCaseDef[] = [
	{
		id: "OTL-01",
		name: "write→run→讲解 端到端",
		dimension: "工具纪律",
		weight: 3,
		run: async (ctx) => {
			const code = 'print("斐波那契数列前 10 项:")\nprint("0 1 1 2 3 5 8 13 21 34")';
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage(
						[fauxText("先把程序写进工作区:\n"), fauxToolCall("write_file", { path: "fib.py", content: code })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage(
						[fauxText("写好了，提交到沙箱运行：\n"), fauxToolCall("run_code", { sandbox: "python", entry: "fib.py" })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage("运行成功，输出如上。", { stopReason: "stop" }),
				],
			});

			const names = evidence.toolCalls.map((t) => t.name);
			ctx.check("工具顺序 write_file→run_code", JSON.stringify(names) === JSON.stringify(["write_file", "run_code"]), names.join(","));
			const write = evidence.toolCalls.find((t) => t.name === "write_file");
			ctx.check("write_file 无错", !!write && !write.isError);
			const run = evidence.toolCalls.find((t) => t.name === "run_code");
			ctx.check("run_code 无错", !!run && !run.isError);
			// mock simulate 提取 print 字面量 → stdout 含数列
			ctx.check("run 结果含真实 stdout", !!run && run.resultText.includes("0 1 1 2 3"), run?.resultText.slice(0, 80));
			ctx.check("有最终讲解文本", evidence.assistantText.length > 0);
		},
	},
	{
		id: "OTL-02",
		name: "run_code 空工作区报错",
		dimension: "工具纪律",
		weight: 2,
		run: async (ctx) => {
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("run_code", { sandbox: "python", entry: "main.py" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("没有文件，我先写一个。", { stopReason: "stop" }),
				],
			});
			const run = evidence.toolCalls.find((t) => t.name === "run_code");
			ctx.check("run_code 是 error", !!run && run.isError, run?.resultText.slice(0, 60));
			ctx.check("错误说明", !!run && run.resultText.includes("工作区为空"), run?.resultText.slice(0, 60));
		},
	},
	{
		id: "OTL-03",
		name: "run_code 入口不存在",
		dimension: "工具纪律",
		weight: 1,
		run: async (ctx) => {
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("write_file", { path: "main.py", content: "print('hi')" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("run_code", { sandbox: "python", entry: "nope.py" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("我写错文件名了。", { stopReason: "stop" }),
				],
			});
			const run = evidence.toolCalls.find((t) => t.name === "run_code");
			ctx.check("入口缺失报错", !!run && run.isError && run.resultText.includes("工作区不存在 nope.py"), run?.resultText.slice(0, 60));
		},
	},
	{
		id: "OTL-04",
		name: "read_file 存在 / 缺失",
		dimension: "工具纪律",
		weight: 1,
		run: async (ctx) => {
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("write_file", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("read_file", { path: "a.txt" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("read_file", { path: "missing.txt" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("好的，看过了。", { stopReason: "stop" }),
				],
			});
			const reads = evidence.toolCalls.filter((t) => t.name === "read_file");
			ctx.check("读到 2 次", reads.length === 2);
			ctx.check("存在可读", reads[0] && !reads[0].isError && reads[0].resultText.includes("hello"), reads[0]?.resultText.slice(0, 40));
			ctx.check("缺失报错", reads[1]?.isError === true && reads[1].resultText.includes("文件不存在"), reads[1]?.resultText.slice(0, 40));
		},
	},
];