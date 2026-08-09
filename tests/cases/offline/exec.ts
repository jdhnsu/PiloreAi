// 离线用例之五:执行后端(simulate 三分支 / exec-client 成功与错误路径,见 TEST-SPEC OEX-01..03)。
import { simulate } from "../../../mock/exec-server.js";
import { execCode, getExecApiBase } from "../../../src/index.js";
import { ensureMockExec } from "../../harness/exec-mock.js";
import type { OfflineCaseDef } from "../../harness/score.js";

export const execCases: OfflineCaseDef[] = [
	{
		id: "OEX-01",
		name: "simulate 三分支",
		dimension: "执行后端",
		weight: 2,
		run: async (ctx) => {
			// ① 纯 print 字面量:逐行拼接
			const s1 = simulate({ "main.py": 'print("a")\nprint("b")' });
			ctx.check("字面量拼接", s1.stdout === "a\nb", JSON.stringify(s1.stdout));
			ctx.check("stderr 为空", s1.stderr === "");
			// ② 有 print 但参数非字符串字面量
			const s2 = simulate({ "m.py": "print(1 + 1)" });
			ctx.check("非字面量提示", s2.stdout.includes("字符串字面量"), JSON.stringify(s2.stdout));
			// ③ 无 print
			const s3 = simulate({ "m.py": "x = 1" });
			ctx.check("无 print 回退 hello", s3.stdout === "hello", JSON.stringify(s3.stdout));
			// ④ simulate 纯函数返回结构
			ctx.check("返回结构", typeof s3.stdout === "string" && typeof s3.stderr === "string");
		},
	},
	{
		id: "OEX-02",
		name: "exec-client 成功路径",
		dimension: "执行后端",
		weight: 2,
		run: async (ctx) => {
			const handle = await ensureMockExec();
			ctx.check("EXEC_API_BASE 已指向 mock", getExecApiBase() === handle.baseUrl);
			const res = await execCode({ sandbox: "python", command: "run", files: { "main.py": 'print("hi")' } });
			ctx.check("ok=true", res.ok === true);
			ctx.check("stdout 回传", res.stdout === "hi", JSON.stringify(res.stdout));
			ctx.check("字段齐全", typeof res.id === "string" && typeof res.duration === "number" && typeof res.stderr === "string");
		},
	},
	{
		id: "OEX-03",
		name: "exec-client 错误路径",
		dimension: "执行后端",
		weight: 1,
		run: async (ctx) => {
			// 连接失败:指向一个必然无法连接的端口
			const prevBase = getExecApiBase();
			process.env.EXEC_API_BASE = "http://127.0.0.1:1";
			let connectErr = false;
			try {
				await execCode({ sandbox: "python", command: "run", files: {} });
			} catch (err) {
				connectErr = err instanceof Error && err.message.includes("无法连接代码执行服务");
			}
			// 恢复现场,避免影响并行用例
			process.env.EXEC_API_BASE = prevBase;
			ctx.check("连接失败中文提示", connectErr);
		},
	},
];