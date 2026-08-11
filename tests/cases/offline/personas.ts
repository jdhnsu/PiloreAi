// 离线用例之三:教学方法与护栏(见 TEST-SPEC OPR-01..03 / OGD-01..03)。
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { makeFauxModels, runFauxCase } from "../../harness/faux-driver.js";
import type { OfflineCaseDef } from "../../harness/score.js";
import { createEduSession } from "../../../src/index.js";

export const personasCases: OfflineCaseDef[] = [
	{
		id: "OPR-01",
		name: "adopt_persona 追加方法论 + 固定 system prompt",
		dimension: "教学行为",
		weight: 3,
		run: async (ctx) => {
			const { evidence, edu } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("好的，我用苏格拉底式方法来讲解。", { stopReason: "stop" }),
				],
			});
			ctx.check("切换成功", evidence.toolCalls.some((t) => t.name === "adopt_persona" && t.args.persona === "socrates"));
			ctx.check("shared.activePersona == socrates", edu.shared.activePersona?.key === "socrates");
			const adopt = evidence.toolResults.find((result) => result.toolName === "adopt_persona");
			ctx.check("systemPrompt 保持自动路由基座", evidence.systemPrompt.includes("教学方法目录"));
			ctx.check("方法论由 toolResult 追加", !!adopt && JSON.stringify(adopt.content).includes("苏格拉底式"));
		},
	},
	{
		id: "OPR-02",
		name: "update_teaching 维护与跨 persona 隔离",
		dimension: "教学行为",
		weight: 2,
		run: async (ctx) => {
			// 注意:同一轮 agent.prompt 内 adopt 至多 2 次(护栏),故「Socrates→Oris」恰好用满;
			// 「切回后进度仍在」已由 shared-state.test.ts 单测覆盖,这里不再切回。
			const { edu } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
					fauxAssistantMessage(
						[fauxToolCall("update_teaching", { stage: "讲解", topic: "闭包", covered: ["闭包定义"] })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "oris" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("update_teaching", { stage: "拆解" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("继续讲。", { stopReason: "stop" }),
				],
			});
			const sp = edu.shared.getTeaching("socrates");
			const or = edu.shared.getTeaching("oris");
			ctx.check("socrates 记忆记录 topic=闭包", sp?.topic === "闭包" && sp?.covered?.includes("闭包定义"));
			ctx.check("oris 记忆独立", or?.stage === "拆解" && or?.topic !== "闭包");
			ctx.check("结束在 oris", edu.shared.activePersona?.key === "oris");
		},
	},
	{
		id: "OPR-03",
		name: "未激活时 update_teaching 报错",
		dimension: "教学行为",
		weight: 1,
		run: async (ctx) => {
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("update_teaching", { stage: "x" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("我先声明方法。", { stopReason: "stop" }),
				],
			});
			const up = evidence.toolCalls.find((t) => t.name === "update_teaching");
			ctx.check("update_teaching 报错", !!up && up.isError, up?.resultText.slice(0, 60));
			ctx.check("提示先 adopt", !!up && up.resultText.includes("adopt_persona"), up?.resultText.slice(0, 60));
		},
	},
	{
		id: "OGD-01",
		name: "同轮 3 次切换被拦截",
		dimension: "护栏",
		weight: 3,
		run: async (ctx) => {
			const { evidence, edu } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "oris" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "feynman" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("换多了，先停。", { stopReason: "stop" }),
				],
			});
			const third = evidence.toolCalls.find((t) => t.name === "adopt_persona" && t.args.persona === "feynman");
			ctx.check("第 3 次被 isError 拦截", !!third && third.isError, third?.resultText.slice(0, 70));
			ctx.check("最终停留 oris", edu.shared.activePersona?.key === "oris");
		},
	},
	{
		id: "OGD-02",
		name: "同 key 重复声明被拦截",
		dimension: "护栏",
		weight: 2,
		run: async (ctx) => {
			const { evidence } = await runFauxCase({
				responses: [
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
					fauxAssistantMessage("好吧，继续。", { stopReason: "stop" }),
				],
			});
			const same = evidence.toolCalls.filter((t) => t.name === "adopt_persona" && t.args.persona === "socrates");
			ctx.check("出现 2 次请求", same.length === 2);
			ctx.check("第 2 次被拦", same[1]?.isError === true, same[1]?.resultText.slice(0, 70));
		},
	},
	{
		id: "OGD-03",
		name: "用户 @ 路径不受护栏限制",
		dimension: "护栏",
		weight: 2,
		run: async (ctx) => {
			// 用户路径(session.setPersona)不经工具、不计数,可随意切换
			const { models } = makeFauxModels();
			const session = createEduSession({ models, providerId: "faux", modelId: "faux-1" });
			session.setPersona("feynman");
			session.setPersona("socrates");
			session.setPersona("oris");
			ctx.check("连续切换不受限", session.persona?.key === "oris");
			session.setPersona(null);
			ctx.check("setPersona(null) 清空", session.persona === undefined);
		},
	},
];
