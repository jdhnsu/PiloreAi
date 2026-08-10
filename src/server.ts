import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createMockExecServer } from "../mock/exec-server.js";
import {
	applyPostgresMigrations,
	createAes256GcmCryptoProvider,
	createEduSession,
	createInMemorySessionStore,
	createPostgresSessionStore,
	EDU_SESSION_SNAPSHOT_VERSION,
	getPersona,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	type EduEvent,
	type EduSession,
	type EduSessionOptions,
	type EduSessionSnapshotV1,
	type PersonaKey,
	type SessionIdentity,
	type SessionStore,
	type StoredRun,
} from "./index.js";

/**
 * Web 适配层：把 EduSession 暴露为 HTTP 接口（多会话）。
 *   GET    /                      静态页面（web/）
 *   GET    /api/sessions          会话历史列表（标题/时间）
 *   POST   /api/sessions          新建会话
 *   DELETE /api/sessions?id=      删除会话
 *   GET    /api/sessions/history?id=  会话历史消息（渲染用）
 *   GET    /api/state?id=         { busy, persona, model, storage }
 *   GET    /api/files?id=         { files: [{ path, content }] }
 *   POST   /api/chat              { sessionId, message } → SSE 流（data: EduEvent JSON），整轮落库
 *   POST   /api/persona           { sessionId, persona: key | null } 设置老师
 *   POST   /api/abort             { sessionId } 中止当前运行
 * 存储：配置 DB_* 且提供 SESSION_ENCRYPTION_KEY（64 位 hex）时走 PostgreSQL 加密持久化，
 * 否则回退进程内存储（重启丢失）。FAUX_DEMO=1 时无需 API key 且固定用内存存储。
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

/* ---------- 会话存储：Postgres（加密）优先，缺配置/不可用时回退进程内 ---------- */

/** Web 演示适配层是单用户场景，身份固定。 */
const IDENTITY: SessionIdentity = { tenantId: "web", userId: "local" };

interface SessionEntry {
	session: EduSession;
	/** 与存储一致的 revision；beginRun/completeRun 的乐观锁基准。 */
	revision: number;
}

function emptySnapshot(): EduSessionSnapshotV1 {
	return { version: EDU_SESSION_SNAPSHOT_VERSION, revision: 0, activePersonaKey: null, teachingByPersona: {}, files: {}, messages: [] };
}

function resolveEncryptionKey(): { keyId: string; key: Buffer } | undefined {
	const raw = process.env.SESSION_ENCRYPTION_KEY?.trim();
	if (!raw) return undefined;
	if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
		console.warn("[web] SESSION_ENCRYPTION_KEY 需为 64 位 hex（32 字节），已忽略");
		return undefined;
	}
	return { keyId: "env", key: Buffer.from(raw, "hex") };
}

async function createSessionStore(demo: boolean): Promise<{ store: SessionStore; backend: "postgres" | "memory" }> {
	if (!demo && process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
		const key = resolveEncryptionKey();
		if (key) {
			const pool = new Pool({
				host: process.env.DB_HOST,
				port: Number(process.env.DB_PORT ?? 5432),
				user: process.env.DB_USER,
				password: process.env.DB_PASSWORD,
				database: process.env.DB_NAME,
				ssl: false,
			});
			try {
				await applyPostgresMigrations(pool);
				const store = createPostgresSessionStore({
					pool,
					crypto: createAes256GcmCryptoProvider({ primaryKeyId: key.keyId, keys: { [key.keyId]: key.key } }),
				});
				return { store, backend: "postgres" };
			} catch (err) {
				console.warn(`[web] Postgres 不可用（${err instanceof Error ? err.message : err}），回退内存持久化`);
				await pool.end().catch(() => {});
			}
		} else {
			console.warn("[web] 已配置 DB_* 但缺少 SESSION_ENCRYPTION_KEY，回退内存持久化（会话重启后丢失）");
		}
	}
	return { store: createInMemorySessionStore(), backend: "memory" };
}

function storeErrorResponse(res: http.ServerResponse, err: unknown): void {
	if (err instanceof SessionNotFoundError) json(res, 404, { error: err.message });
	else if (err instanceof SessionBusyError || err instanceof SessionRevisionConflictError) json(res, 409, { error: err.message });
	else json(res, 500, { error: err instanceof Error ? err.message : String(err) });
}

/** 历史渲染用：消息内容统一提取为纯文本（user 原文 / assistant 文本块拼接，跳过工具块）。 */
function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: string; text: string } => !!block && typeof block === "object" && (block as { type?: unknown }).type === "text")
		.map((block) => block.text)
		.join("");
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
				[fauxText("文件写好了，提交到沙箱运行看看输出：\n"), fauxToolCall("run_code", { sandbox: "python", entry: "fib.py" })],
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

/** 每个候选端口用独立的 server 实例：Windows 上同一 server 连续 listen 会复用旧的 listening 回调（产生假成功日志）。 */
function startServer(
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
	candidates: number[],
	demo: boolean,
): void {
	let index = 0;
	const tryNext = () => {
		const port = candidates[index];
		const server = http.createServer(handler);
		server.once("error", (err: NodeJS.ErrnoException) => {
			server.removeAllListeners();
			index += 1;
			if ((err.code === "EACCES" || err.code === "EADDRINUSE") && index < candidates.length) {
				console.warn(`[web] 端口 ${port} 不可用（${err.code}），改用 ${candidates[index]}`);
				tryNext();
				return;
			}
			console.error("[web] 启动失败:", err);
			process.exit(1);
		});
		server.listen(port, () => {
			console.log(`[web] PiLore 界面: http://localhost:${port}${demo ? "（演示模式，无需 API key）" : ""}`);
		});
	};
	tryNext();
}

async function main(): Promise<void> {
	const sessionOptions: EduSessionOptions = FAUX_DEMO ? await createDemoSessionOptions() : {};
	const { store, backend } = await createSessionStore(FAUX_DEMO);
	console.log(`[web] 会话持久化: ${backend === "postgres" ? "PostgreSQL（AES-256-GCM）" : "进程内存（重启后丢失）"}`);

	// 已加载会话的进程内缓存；未命中时从存储解密恢复
	const entries = new Map<string, SessionEntry>();

	async function getEntry(sessionId: string): Promise<SessionEntry> {
		const cached = entries.get(sessionId);
		if (cached) return cached;
		const stored = await store.load(sessionId);
		if (!stored) throw new SessionNotFoundError(sessionId);
		const entry: SessionEntry = { session: createEduSession({ ...sessionOptions, snapshot: stored.snapshot }), revision: stored.revision };
		entries.set(sessionId, entry);
		return entry;
	}

	const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const sessionIdParam = url.searchParams.get("id") ?? "";
		try {
			if (req.method === "GET" && url.pathname === "/api/sessions") {
				const summaries = await store.list(IDENTITY);
				json(res, 200, {
					storage: backend,
					sessions: summaries.map((s) => ({
						id: s.id,
						title: s.title,
						revision: s.revision,
						busy: !!s.activeRunId,
						createdAt: s.createdAt,
						updatedAt: s.updatedAt,
					})),
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/sessions") {
				const created = await store.create({ identity: IDENTITY, snapshot: emptySnapshot() });
				entries.set(created.id, { session: createEduSession({ ...sessionOptions, snapshot: created.snapshot }), revision: 0 });
				json(res, 200, { sessionId: created.id });
				return;
			}
			if (req.method === "DELETE" && url.pathname === "/api/sessions") {
				if (!sessionIdParam) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				const entry = entries.get(sessionIdParam);
				if (entry?.session.busy) {
					json(res, 409, { error: "会话正在运行，先中止再删除" });
					return;
				}
				await store.delete(sessionIdParam);
				entries.delete(sessionIdParam);
				json(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/sessions/history") {
				if (!sessionIdParam) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionIdParam);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				const snapshot = entry.session.exportSnapshot();
				const messages = snapshot.messages.flatMap((m): Array<{ role: "user" | "assistant"; text: string }> => {
					if (m.role !== "user" && m.role !== "assistant") return [];
					const text = textOfContent("content" in m ? m.content : undefined);
					if (!text.trim()) return [];
					return [{ role: m.role, text }];
				});
				json(res, 200, { sessionId: sessionIdParam, persona: entry.session.persona?.key ?? null, messages });
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/state") {
				if (!sessionIdParam) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionIdParam);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				json(res, 200, {
					busy: entry.session.busy,
					persona: entry.session.persona ? { key: entry.session.persona.key, name: entry.session.persona.name } : undefined,
					model: entry.session.modelInfo,
					demo: FAUX_DEMO,
					storage: backend,
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/files") {
				if (!sessionIdParam) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionIdParam);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				const files = entry.session.listFiles().map((p) => ({ path: p, content: entry.session.readFile(p) ?? "" }));
				json(res, 200, { files });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/abort") {
				const body = await readJsonBody(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				if (!sessionId) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				entries.get(sessionId)?.session.abort();
				json(res, 200, { ok: true });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/persona") {
				const body = await readJsonBody(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				if (!sessionId) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				const p = body.persona;
				if (p !== null && (typeof p !== "string" || !getPersona(p))) {
					json(res, 400, { error: "persona 需为 feynman/socrates/oris 或 null" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionId);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				entry.session.setPersona(p as PersonaKey | null);
				json(res, 200, {
					ok: true,
					persona: entry.session.persona ? { key: entry.session.persona.key, name: entry.session.persona.name } : null,
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/chat") {
				const body = await readJsonBody(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				const message = typeof body.message === "string" ? body.message.trim() : "";
				if (!sessionId) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				if (!message) {
					json(res, 400, { error: "message 不能为空" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionId);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				if (entry.session.busy) {
					json(res, 409, { error: "上一轮对话还在进行，可调用 POST /api/abort" });
					return;
				}
				const [providerId = "", modelId = ""] = entry.session.modelInfo.split("/");
				let run: StoredRun;
				try {
					run = await store.beginRun({
						sessionId,
						expectedRevision: entry.revision,
						providerId,
						modelId,
						personaKey: entry.session.persona?.key,
						audit: { input: message },
					});
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				// 客户端断开时 write 会触发 error 事件，吞掉以免进程崩溃
				res.on("error", () => {});
				let outputText = "";
				const toolResults: Array<{ toolName: string; isError: boolean; text: string }> = [];
				let runError: string | undefined;
				const send = (event: EduEvent) => {
					if (event.type === "text_delta") outputText += event.delta;
					else if (event.type === "tool_end") toolResults.push({ toolName: event.toolName, isError: event.isError, text: event.text.slice(0, 2000) });
					else if (event.type === "done") runError = event.errorMessage;
					try {
						if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
					} catch {
						/* 连接已断开 */
					}
				};
				let finished = false;
				res.on("close", () => {
					if (!finished && entry.session.busy) entry.session.abort();
				});
				const audit = () => ({ input: message, output: outputText.slice(0, 8000), toolResults });
				try {
					await entry.session.prompt(message, send);
					if (runError) {
						await store.failRun({ runId: run.id, sessionId, errorCode: "RUN_FAILED", audit: audit() });
					} else {
						const updated = await store.completeRun({
							runId: run.id,
							sessionId,
							expectedRevision: entry.revision,
							snapshot: { ...entry.session.exportSnapshot(), revision: entry.revision },
							audit: audit(),
						});
						entry.revision = updated.revision;
					}
				} catch (err) {
					try {
						await store.failRun({ runId: run.id, sessionId, errorCode: "RUN_ERROR", audit: audit() });
					} catch {
						/* 存储失败不掩盖主错误 */
					}
					const text = err instanceof Error ? err.message : String(err);
					try {
						if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: "error", message: text })}\n\n`);
					} catch {
						/* 连接已断开 */
					}
				} finally {
					finished = true;
					res.end();
				}
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
	};

	// 默认 8600：本机 8100 常被 WSL2/Hyper-V 保留端口段（如 8079-8178）占用导致 EACCES；
	// 未显式指定 WEB_PORT 时自动回退尝试后续端口，保证 npm run web 总能起来
	const explicitPort = process.env.WEB_PORT !== undefined;
	const port = Number(process.env.WEB_PORT ?? 8600);
	const candidates = explicitPort ? [port] : Array.from({ length: 10 }, (_, i) => port + i);

	startServer(handler, candidates, FAUX_DEMO);
}

main().catch((err) => {
	console.error("[web] 启动失败:", err);
	process.exit(1);
});
