// 在线用例:路由选择(真实模型,见 TEST-SPEC ORT-01..04)。
// 每条规则 judge 只读 evidence,达成度 0/0.5/1。
import type { OnlineCaseDef } from "../../harness/session-driver.js";

export const routerCases: OnlineCaseDef[] = [
	{
		id: "ORT-01",
		name: "抽象话题→Feynman",
		dimension: "在线路由",
		weight: 3,
		prompts: ["太抽象了，完全听不懂，能打个比方给我讲讲什么是闭包吗？"],
		rules: [
			{
				name: "采用 feynman",
				weight: 2,
				judge: (ev) => {
					const adopt = ev.profileEvents.find((p) => p.source === "model");
					if (!adopt) return 0;
					return adopt.profile === "feynman" ? 1 : adopt.profile ? 0.5 : 0;
				},
			},
			{
				name: "费曼风格特征(类比/复述)",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					const hits = ["类比", "复述", "大白话", "比如", "打个比方", "像"] ;
					const n = hits.filter((h) => t.includes(h)).length;
					if (n >= 2) return 1;
					return n === 1 ? 0.5 : 0;
				},
			},
			{
				name: "结束未乱交还(auto)",
				weight: 1,
				judge: (ev) => {
					const last = ev.profileEvents[ev.profileEvents.length - 1];
					return last && last.profile === null ? 0 : 1; // 简单问答不应该自己交还
				},
			},
		],
	},
	{
		id: "ORT-02",
		name: "原理辨析→Socrates",
		dimension: "在线路由",
		weight: 3,
		prompts: ["== 和 is 有什么区别？给我讲透原理，并辨析易混淆点。"],
		rules: [
			{
				name: "采用 socrates",
				weight: 2,
				judge: (ev) => {
					const adopt = ev.profileEvents.find((p) => p.source === "model");
					if (!adopt) return 0;
					return adopt.profile === "socrates" ? 1 : adopt.profile ? 0.5 : 0;
				},
			},
			{
				name: "结构(是什么/为什么/易错点)",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					const hits = ["是什么", "为什么", "易错", "区别", "注意"];
					const n = hits.filter((h) => t.includes(h)).length;
					if (n >= 3) return 1;
					return n >= 1 ? 0.5 : 0;
				},
			},
			{
				name: "给出对比(表格/两栏)",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					return /对比|表格|\||----/.test(t) ? 1 : 0.5;
				},
			},
		],
	},
	{
		id: "ORT-03",
		name: "前置补基础→Oris",
		dimension: "在线路由",
		weight: 3,
		prompts: ["我想学 Django，但连 HTTP 都不太懂，该从哪开始？"],
		rules: [
			{
				name: "采用 oris",
				weight: 2,
				judge: (ev) => {
					const adopt = ev.profileEvents.find((p) => p.source === "model");
					if (!adopt) return 0;
					return adopt.profile === "oris" ? 1 : adopt.profile ? 0.5 : 0;
				},
			},
			{
				name: "拆解/脚手架特征",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					const hits = ["拆解", "前置", "基础", "步骤", "要先", "第一步", "黑箱"];
					const n = hits.filter((h) => t.includes(h)).length;
					if (n >= 2) return 1;
					return n >= 1 ? 0.5 : 0;
				},
			},
			{
				name: "结尾确认跟不跟得上",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					return /跟得上|听懂了|如何|要不要|下面再|下一步/.test(t) ? 1 : 0.5;
				},
			},
		],
	},
	{
		id: "ORT-04",
		name: "事实问答不触发 profile",
		dimension: "在线路由",
		weight: 2,
		prompts: ["Python 里怎么读一个 txt 文件？"],
		rules: [
			{
				name: "不调用任何方法",
				weight: 2,
				judge: (ev) => {
					const adopt = ev.profileEvents.find((p) => p.source === "model");
					return adopt ? 0 : 1;
				},
			},
			{
				name: "直接给出简洁答案",
				weight: 1,
				judge: (ev) => {
					const t = ev.allText;
					return /open\(|read\(|文件|读/.test(t) ? 1 : 0.5;
				},
			},
		],
	},
];
