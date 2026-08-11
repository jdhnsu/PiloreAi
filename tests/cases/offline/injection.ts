// 离线用例之六:依赖注入(自定义 personas 集合与自定义 ExecClient,见 TEST-SPEC OIN-01/02)。
// 验证「作为库嵌入」的两个替换点:老师集合与执行后端均可注入,不依赖内置 agent-design/ 与 EXEC_API_BASE。
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { runFauxCase } from "../../harness/faux-driver.js";
import type { OfflineCaseDef } from "../../harness/score.js";
import { createEduSession, parsePersona, type ExecClient, type ExecRequest, type ExecResponse } from "../../../src/index.js";

// 用纯函数 parsePersona 从内嵌字符串构造自定义老师（不碰磁盘）
function makeCustomPersona(key: string, name: string, body: string) {
	const source = [
		"---",
		`name: ${name}`,
		`description: 测试用老师 ${name}`,
		"mode: primary",
		"capabilities:",
		"  file.write: allow",
		"  file.modify: deny",
		"---",
		"",
		body,
	].join("\n");
	return parsePersona(source, `${key}.md`);
}

const CUSTOM_TEACHER = makeCustomPersona("guide", "Guide", "## Guide 的方法论（注入测试用）\n先打比方，再复述检验。");

export const injectionCases: OfflineCaseDef[] = [
	{
		id: "OIN-01",
		name: "自定义 personas 集合可注入",
		dimension: "教学行为",
		weight: 2,
		run: async (ctx) => {
			const personas = [CUSTOM_TEACHER];
			const { evidence, edu } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "guide" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("update_teaching", { stage: "讲解", topic: "注入测试" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("好的，我用 Guide 方法讲。", { stopReason: "stop" }),
				],
				agentOptions: { personas },
			});
			ctx.check("adopt 自定义 key 成功", edu.shared.activePersona?.key === "guide");
			const adopt = evidence.toolResults.find((result) => result.toolName === "adopt_persona");
			ctx.check("toolResult 注入自定义方法论", !!adopt && JSON.stringify(adopt.content).includes("Guide 的方法论（注入测试用）"));
			ctx.check("教学进度写入", edu.shared.getTeaching("guide")?.topic === "注入测试");
			ctx.check("edu.personas 为注入集合", edu.personas === personas);
		},
	},
	{
		id: "OIN-02",
		name: "自定义 ExecClient 可注入",
		dimension: "执行后端",
		weight: 2,
		run: async (ctx) => {
			const calls: ExecRequest[] = [];
			const exec: ExecClient = {
				exec: async (req) => {
					calls.push(req);
					const res: ExecResponse = { id: "injected:1", ok: true, duration: 1, stdout: "INJECTED_OUTPUT", stderr: "" };
					return res;
				},
			};
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage(
						[fauxText("写入:\n"), fauxToolCall("write_file", { path: "main.py", content: "print('hi')" })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxToolCall("run_code", { sandbox: "python", entry: "main.py" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("运行完毕。", { stopReason: "stop" }),
				],
				agentOptions: { exec },
			});
			ctx.check("注入后端被调用一次", calls.length === 1);
			ctx.check("请求带完整 files", calls[0]?.files["main.py"] === "print('hi')");
			const run = evidence.toolCalls.find((t) => t.name === "run_code");
			ctx.check("run_code 走注入后端输出", !!run && run.resultText.includes("INJECTED_OUTPUT"), run?.resultText.slice(0, 60));
		},
	},
];
