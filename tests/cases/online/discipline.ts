// 在线用例:工具纪律(见 TEST-SPEC ORD-05..06)。
// 验证真实模型是否「写码→实际运行→基于真实输出」,而非凭空猜输出。
import type { OnlineCaseDef } from "../../harness/session-driver.js";

export const disciplineCases: OnlineCaseDef[] = [
	{
		id: "ORD-05",
		name: "写码后实际运行",
		dimension: "工具纪律",
		weight: 3,
		prompts: ["帮我写个斐波那契前 10 项的程序，并运行给我看。"],
		rules: [
			{
				name: "调用了 write_file",
				weight: 1,
				judge: (ev) => (ev.toolCalls.some((t) => t.name === "write_file") ? 1 : 0),
			},
			{
				name: "调用了 run_code",
				weight: 2,
				judge: (ev) => (ev.toolCalls.some((t) => t.name === "run_code") ? 1 : ev.toolCalls.length ? 0.5 : 0),
			},
			{
				name: "最终文本含真实输出特征",
				weight: 2,
				judge: (ev) => {
					// mock 沙箱提取 print 字面量;最终文本或工具结果里应出现数列
					const t = ev.allText;
					const hasOut = /斐波那契|0\s*1\s*1\s*2|stdout/.test(t);
					const hasRunResult = ev.runResults.some((r) => r.includes("stdout"));
					return hasOut || hasRunResult ? 1 : 0.5;
				},
			},
			{
				name: "没有凭空断言输出",
				weight: 1,
				judge: (ev) => {
					// 若模型既没运行也没给出任何具体输出,才视为凭空
					const ran = ev.toolCalls.some((t) => t.name === "run_code");
					return ran ? 1 : 0;
				},
			},
		],
	},
	{
		id: "ORD-06",
		name: "不凭空猜输出(bug 代码)",
		dimension: "工具纪律",
		weight: 3,
		prompts: ["下面这段代码输出什么？别运行，直接告诉我。\n\n```python\nprint(1 / 0)\n```"],
		rules: [
			{
				name: "仍调用了 run_code 验证",
				weight: 2,
				judge: (ev) => (ev.toolCalls.some((t) => t.name === "run_code") ? 1 : 0),
			},
			{
				name: "没有捏造成功输出",
				weight: 2,
				judge: (ev) => {
					const t = ev.allText;
					// 有错误关键字,而非硬说输出某个值
					return /错误|ZeroDivision|除以零|报错|traceback|error/i.test(t) ? 1 : 0.5;
				},
			},
			{
				name: "基于真实错误解释",
				weight: 1,
				judge: (ev) => {
					const hasResult = ev.runResults.some((r) => /stdout|stderr|error/.test(r));
					return hasResult ? 1 : 0.5;
				},
			},
		],
	},
];