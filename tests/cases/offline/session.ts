// 离线用例之四:会话协议(见 TEST-SPEC OSS-01..04)。
// 通过 createEduSession + faux 驱动,校验事件序列、persona 单发、busy 互斥、abort 后可重发。
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { OfflineCaseDef } from "../../harness/score.js";
import { createEduSession } from "../../../src/session.js";

function makeFauxSession(opts?: { slowTokensPerSecond?: number }) {
	// 默认即时假响应;slow 用 tokensPerSecond 控制流速,便于让 abort/busy 落在运行中段
	const f = opts?.slowTokensPerSecond ? fauxProvider({ tokensPerSecond: opts.slowTokensPerSecond }) : fauxProvider();
	const models = createModels();
	models.setProvider(f.provider);
	const session = createEduSession({ models, providerId: "faux", modelId: "faux-1" });
	return { session, faux: f };
}

export const sessionCases: OfflineCaseDef[] = [
	{
		id: "OSS-01",
		name: "一轮事件顺序(协议)",
		dimension: "会话协议",
		weight: 3,
		run: async (ctx) => {
			const { session, faux } = makeFauxSession();
			faux.setResponses([
				fauxAssistantMessage([fauxText("写文件:\n"), fauxToolCall("write_file", { path: "a.txt", content: "hi" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("写好了。", { stopReason: "stop" }),
			]);
			const events: string[] = [];
			await session.prompt("写个文件", (e) => events.push(e.type));
			ctx.check("start 最先", events[0] === "start");
			ctx.check("done 最后", events[events.length - 1] === "done");
			ctx.check("tool_start 出现", events.includes("tool_start"));
			ctx.check("tool_end 出现", events.includes("tool_end"));
			ctx.check("tool_start 在 tool_end 前", events.indexOf("tool_start") < events.lastIndexOf("tool_end"));
			ctx.check("text_delta 出现", events.includes("text_delta"));
			ctx.check("message_end 在 done 前", events.lastIndexOf("message_end") > -1 && events.lastIndexOf("message_end") < events.lastIndexOf("done"));
		},
	},
	{
		id: "OSS-02",
		name: "persona 事件单发且状态一致",
		dimension: "会话协议",
		weight: 2,
		run: async (ctx) => {
			const { session, faux } = makeFauxSession();
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "socrates" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("开始讲解。", { stopReason: "stop" }),
			]);
			const personaEvents: { persona: string | null; source: string }[] = [];
			await session.prompt("讲一下吧", (e) => {
				if (e.type === "persona") personaEvents.push({ persona: e.persona, source: e.source });
			});
			ctx.check("只发 1 条 persona 事件", personaEvents.length === 1, `count=${personaEvents.length}`);
			ctx.check("值 socrates", personaEvents[0]?.persona === "socrates");
			ctx.check("来源 model", personaEvents[0]?.source === "model");
			ctx.check("与状态一致", session.persona?.key === "socrates");
		},
	},
	{
		id: "OSS-03",
		name: "busy 互斥",
		dimension: "会话协议",
		weight: 2,
		run: async (ctx) => {
			const { session, faux } = makeFauxSession({ slowTokensPerSecond: 200 });
			faux.setResponses([
				fauxAssistantMessage("第一轮(慢速)……", { stopReason: "stop" }),
			]);
			const first = session.prompt("完成", () => undefined);
			// 立即第二次 → 抛 busy
			let busyError = false;
			try {
				await session.prompt("再来", () => undefined);
			} catch {
				busyError = true;
			}
			ctx.check("busy 时第二次抛出", busyError);
			await first;
			ctx.check("结束后 busy=false", session.busy === false);
		},
	},
	{
		id: "OSS-04",
		name: "abort 后可重发",
		dimension: "会话协议",
		weight: 2,
		run: async (ctx) => {
			// 用慢速 faux,让第二轮在 abort 发生时仍在进行;abort 后不抛、第三轮可正常发。
			const { session, faux } = makeFauxSession({ slowTokensPerSecond: 50 });
			faux.setResponses([fauxAssistantMessage("第一轮正常结束。", { stopReason: "stop" })]);
			await session.prompt("第一问", () => undefined);
			ctx.check("第一轮正常完成", session.busy === false);

			faux.setResponses([
				fauxAssistantMessage("这是一条足够长、会被中途打断的回复,用于确保 abort 真正作用于运行中的一轮。", {
					stopReason: "stop",
				}),
			]);
			let abortThrew = false;
			const p = session.prompt("第二问(将被中断)", () => undefined);
			setTimeout(() => session.abort(), 15);
			try {
				await p;
			} catch {
				abortThrew = true;
			}
			ctx.check("abort 后不 reject/throw", !abortThrew);

			faux.setResponses([fauxAssistantMessage("第三轮恢复正常。", { stopReason: "stop" })]);
			let thirdOk = true;
			try {
				await session.prompt("第三问", () => undefined);
			} catch {
				thirdOk = false;
			}
			ctx.check("abort 后可重发", thirdOk && session.busy === false);
		},
	},
];