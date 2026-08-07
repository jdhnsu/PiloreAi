import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createMockExecServer } from "../mock/exec-server.js";
import { createEduSession, type EduEvent, type EduSessionOptions } from "./session.js";
import { getPersona, type PersonaKey } from "./personas.js";

/**
 * Web 适配层：把 EduSession 暴露为 HTTP 接口。
 *   GET  /            静态页面（web/）
 *   GET  /api/state   { busy, persona, model }
 *   GET  /api/files   { files: [{ path, content }] }
 *   POST /api/chat    { message } → SSE 流（data: EduEvent JSON）
 *   POST /api/persona { persona: key | null } 设置老师，null = 切回 PiLore 自动路由
 *   POST /api/abort   中止当前运行
 * FAUX_DEMO=1 时无需 API key：fauxProvider 脚本化回复 + 进程内 mock 执行服务。
 */

const FAUX_DEMO = process.env.FAUX_DEMO === "1";
// path.resolve 去掉 fileURLToPath 目录 URL 的尾部斜杠，保证前缀守卫一致
const WEB_ROOT = path.resolve(fileURLToPath(new URL("../web/", import.meta.url)));
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	let body = "";
	for await (const chunk of req) {
		body += chunk;
		if (body.length > 1_000_000) throw new Error("请求体过大");
	}
	return JSON.parse(body || "{}") as Record<string, unknown>;
}

async function createDemoSessionOptions(): Promise<EduSessionOptions> {
	const mock = createMockExecServer();
	await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
	process.env.EXEC_API_BASE = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);

	const fibCode = ['print("斐波那契数列前 10 项:")', 'print("0 1 1 2 3 5 8 13 21 34")', ""].join("\n");
	let step = 0;
	// 每轮对话固定走 write_file → run_code → 总结，脚本可无限重复
	const next = () => {
		step += 1;
		const phase = ((step - 1) % 3) + 1;
		if (phase === 1) {
			return fauxAssistantMessage(
				[fauxText("好！我们先把程序写出来：\n"), fauxToolCall("write_file", { path: "fib.py", content: fibCode })],
				{ stopReason: "toolUse" },
			);
		}
		if (phase === 2) {
			return fauxAssistantMessage(
				[fauxText("文件写好了，提交到沙箱运行看看输出：\n"), fauxToolCall("run_code", { sandbox: "python", command: "run" })],
				{ stopReason: "toolUse" },
			);
		}
		return fauxAssistantMessage(
			"运行成功！输出和预期一致。\n\n讲解：第一行打印标题，第二行打印数列本身。\n\n（演示模式：回复由 fauxProvider 脚本化。在 .env 配置 DEEPSEEK_API_KEY 后运行 npm run web 即为真实模型）",
			{ stopReason: "stop" },
		);
	};
	faux.setResponses(Array.from({ length: 300 }, () => next));
	return { models, providerId: "faux", modelId: "faux-1" };
}

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
	const file = path.resolve(WEB_ROOT, rel);
	if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) {
		json(res, 403, { error: "forbidden" });
		return;
	}
	try {
		const data = await readFile(file);
		res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
		res.end(data);
	} catch {
		json(res, 404, { error: "not found" });
	}
}

async function main(): Promise<void> {
	const session = createEduSession(FAUX_DEMO ? await createDemoSessionOptions() : {});

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		try {
			if (req.method === "GET" && url.pathname === "/api/state") {
				json(res, 200, {
					busy: session.busy,
					persona: session.persona ? { key: session.persona.key, name: session.persona.name } : undefined,
					model: session.modelInfo,
					demo: FAUX_DEMO,
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/files") {
				const files = session.listFiles().map((p) => ({ path: p, content: session.readFile(p) ?? "" }));
				json(res, 200, { files });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/abort") {
				session.abort();
				json(res, 200, { ok: true });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/persona") {
				const body = await readJsonBody(req);
				const p = body.persona;
				if (p !== null && (typeof p !== "string" || !getPersona(p))) {
					json(res, 400, { error: "persona 需为 feynman/socrates/oris 或 null" });
					return;
				}
				session.setPersona(p as PersonaKey | null);
				json(res, 200, { ok: true, persona: session.persona ? { key: session.persona.key, name: session.persona.name } : null });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/chat") {
				const body = await readJsonBody(req);
				const message = typeof body.message === "string" ? body.message.trim() : "";
				if (!message) {
					json(res, 400, { error: "message 不能为空" });
					return;
				}
				if (session.busy) {
					json(res, 409, { error: "上一轮对话还在进行，可调用 POST /api/abort" });
					return;
				}
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				// 客户端断开时 write 会触发 error 事件，吞掉以免进程崩溃
				res.on("error", () => {});
				const send = (event: EduEvent) => {
					try {
						if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
					} catch {
						/* 连接已断开 */
					}
				};
				let finished = false;
				res.on("close", () => {
					if (!finished && session.busy) session.abort();
				});
				await session.prompt(message, send);
				finished = true;
				res.end();
				return;
			}
			if (req.method === "GET") {
				await serveStatic(res, url.pathname);
				return;
			}
			json(res, 405, { error: "method not allowed" });
		} catch (err) {
			if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
			else res.end();
		}
	});

	const port = Number(process.env.WEB_PORT ?? 8100);
	server.listen(port, () => {
		console.log(`[web] PiLore 界面: http://localhost:${port}${FAUX_DEMO ? "（演示模式，无需 API key）" : ""}`);
	});
}

main().catch((err) => {
	console.error("[web] 启动失败:", err);
	process.exit(1);
});
