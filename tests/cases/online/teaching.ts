// 在线用例:教学行为(见 TEST-SPEC ORD-07..08)。
// 验证真实模型在多轮对话里维护教学进度、不随意换老师、能触发 auto 交还。
import type { OnlineCaseDef } from "../../harness/session-driver.js";

export const teachingCases: OnlineCaseDef[] = [
	{
		id: "ORD-07",
		name: "多轮教学进度维护",
		dimension: "教学行为",
		weight: 3,
		prompts: [
			"我想学 Django，但连 HTTP 都不太懂，该从哪开始？",
			"那 GET 和 POST 有什么区别？",
			"懂了，我们继续。",
		],
		rules: [
			{
				name: "第 1 轮正确路由到 oris",
				weight: 1,
				judge: (ev) => {
					const adopt = ev.personaEvents.find((p) => p.source === "model");
					return adopt?.persona === "oris" ? 1 : adopt?.persona ? 0.5 : 0;
				},
			},
			{
				name: "多轮内没有反复换人",
				weight: 2,
				judge: (ev) => {
					// 3 轮里 persona 事件数 <= 2(开始一次 + 可能的收尾交还)
					const adopt = ev.personaEvents.filter((p) => p.source === "model");
					return adopt.length <= 2 ? 1 : 0.5;
				},
			},
			{
				name: "调用过 update_teaching",
				weight: 2,
				judge: (ev) => (ev.teachingCalls.length > 0 ? 1 : 0),
			},
			{
				name: "教学阶段推进后 auto 交还",
				weight: 2,
				judge: (ev) => {
					const last = ev.personaEvents[ev.personaEvents.length - 1];
					return last?.persona === null ? 1 : 0.5;
				},
			},
		],
	},
	{
		id: "ORD-08",
		name: "收尾自测",
		dimension: "教学行为",
		weight: 2,
		prompts: ["用 Python 讲一下装饰器，并出一个自测题。"],
		rules: [
			{
				name: "结尾给了自测/练习",
				weight: 2,
				judge: (ev) => {
					const t = ev.allText;
					return /试试|练习|自测|题目|你来说|你怎么看|问号/.test(t) ? 1 : 0.5;
				},
			},
			{
				name: "一路维持同一方法",
				weight: 1,
				judge: (ev) => {
					const adopt = ev.personaEvents.filter((p) => p.source === "model");
					return adopt.length <= 2 ? 1 : 0.5;
				},
			},
		],
	},
];