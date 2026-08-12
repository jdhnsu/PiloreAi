import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type MutableModels } from "@earendil-works/pi-ai";
import { simulate } from "../../../mock/exec-server.js";
import {
	applyPostgresMigrations,
	createAes256GcmCryptoProvider,
	createCodeMentorSession,
	createEnglishMentorSession,
	createInMemorySessionStore,
	createPostgresSessionStore,
	getDefaultCodeProfiles,
	getDefaultEnglishProfiles,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	type CodeMentorSession,
	type EnglishMentorSession,
	type ExecClient,
	type ProfileDefinition,
	type Session,
	type SessionEvent,
	type SessionIdentity,
	type SessionSnapshotV1,
	type SessionStore,
	type StoredRun,
	type WordEntry,
} from "../../index.js";

/**
 * Web 适配层：把 Domain Pack（code / english）暴露为 HTTP 接口（多会话，pack 可切换）。
 *   GET    /                      静态页面（web/）
 *   GET    /api/packs             可用 pack 及其 profile 目录（chips / 欢迎语来源）
 *   GET    /api/sessions?pack=    某 pack 的会话历史列表（标题/时间）
 *   POST   /api/sessions { pack } 新建会话（缺省 code）
 *   DELETE /api/sessions?id=      删除会话
 *   GET    /api/sessions/history?id=  会话历史消息（渲染用）
 *   GET    /api/state?id=         { busy, pack, profile, model, demo, storage, profiles }
 *   GET    /api/panel?id=         { kind: files|vocabulary }（工作区侧栏）
 *   POST   /api/chat              { sessionId, message } → SSE 流（data: SessionEvent JSON），整轮落库
 *   POST   /api/profile           { sessionId, profile: key | null } 设置老师（profile）
 *   POST   /api/abort             { sessionId } 中止当前运行
 * 存储：配置 DB_* 且提供 SESSION_ENCRYPTION_KEY（64 位 hex）时走 PostgreSQL 加密持久化，
 * 否则回退进程内存储（重启丢失）。FAUX_DEMO=1 时无需 API key 且固定用内存存储。
 * 会话按 pack 分桶：identity.courseId = pack id，恢复时据此选择 pack 工厂。
 */

const FAUX_DEMO = process.env.FAUX_DEMO === "1";
// path.resolve 去掉 fileURLToPath 目录 URL 的尾部斜杠，保证前缀守卫一致
const WEB_ROOT = path.resolve(fileURLToPath(new URL("../../../web/", import.meta.url)));
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

/* ---------- Pack 注册表：每包自带 profiles / 会话工厂 / 工作区侧栏 ---------- */

/** 会话公共接口 + 各 pack 的 modelInfo（供运行审计）。 */
interface PackSession extends Session {
	readonly modelInfo: string;
}

interface SessionCreateConfig {
	models?: MutableModels;
	providerId?: string;
	modelId?: string;
	useEnvCustomModel?: boolean;
	snapshot?: SessionSnapshotV1;
	exec?: ExecClient;
}

/** 工作区侧栏数据：code → 文件，english → 词汇本。 */
type SidebarPanel = { kind: "files"; files: Array<{ path: string; content: string }> } | { kind: "vocabulary"; words: WordEntry[] };

interface WebPack {
	id: string;
	name: string;
	tagline: string;
	suggestions: string[];
	profiles: ProfileDefinition[];
	create(config: SessionCreateConfig): PackSession;
	panel(session: PackSession): SidebarPanel;
}

function createFauxModels(script: () => ReturnType<typeof fauxAssistantMessage>): MutableModels {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(Array.from({ length: 300 }, () => script));
	return models;
}

/** 演示用进程内执行后端：不真正运行代码，按 mock 规则模拟 stdout。 */
const demoExec: ExecClient = {
	async exec(request) {
		const { stdout, stderr } = simulate(request.files ?? {});
		return { id: `mock:${Date.now()}`, ok: true, duration: 120 + Math.floor(Math.random() * 100), stdout, stderr };
	},
};

let codeDemoStep = 0;
const nextCodeDemoStep = () => {
	const phase = (codeDemoStep++ % 5) + 1;
	if (phase === 1) {
		return fauxAssistantMessage([fauxText("好！我们先把程序写出来：\n"), fauxToolCall("activate_toolset", { toolset: "workspace" })], {
			stopReason: "toolUse",
		});
	}
	if (phase === 2) {
		return fauxAssistantMessage(
			[fauxText("文件写好了：\n"), fauxToolCall("write_file", { path: "fib.py", content: ['print("斐波那契数列前 10 项:")', 'print("0 1 1 2 3 5 8 13 21 34")', ""].join("\n") })],
			{ stopReason: "toolUse" },
		);
	}
	if (phase === 3) {
		return fauxAssistantMessage([fauxText("再加载运行工具组，把代码提交到沙箱：\n"), fauxToolCall("activate_toolset", { toolset: "execution" })], {
			stopReason: "toolUse",
		});
	}
	if (phase === 4) {
		return fauxAssistantMessage([fauxText("运行看看输出：\n"), fauxToolCall("run_code", { sandbox: "python", entry: "fib.py" })], {
			stopReason: "toolUse",
		});
	}
	return fauxAssistantMessage(
		"运行成功！输出和预期一致。\n\n讲解：第一行打印标题，第二行打印数列本身。\n\n（演示模式：回复由 fauxProvider 脚本化。在 .env 配置 DEEPSEEK_API_KEY 后运行 npm run web 即为真实模型）",
		{ stopReason: "stop" },
	);
};

let englishDemoStep = 0;
const nextEnglishDemoStep = () => {
	const phase = (englishDemoStep++ % 5) + 1;
	if (phase === 1) {
		return fauxAssistantMessage([fauxText("今天我们学一个高频词，先加载词汇工具：\n"), fauxToolCall("activate_toolset", { toolset: "vocabulary" })], {
			stopReason: "toolUse",
		});
	}
	if (phase === 2) {
		return fauxAssistantMessage(
			[
				fauxText("把它收进你的词汇本：\n"),
				fauxToolCall("learn_word", { word: "persistence", meaning: "坚持不懈", phonetic: "pəˈsɪstəns", pos: "n.", example: "Persistence is the key to learning English." }),
			],
			{ stopReason: "toolUse" },
		);
	}
	if (phase === 3) {
		return fauxAssistantMessage([fauxText("再来一组练习工具，考考你：\n"), fauxToolCall("activate_toolset", { toolset: "practice" })], {
			stopReason: "toolUse",
		});
	}
	if (phase === 4) {
		return fauxAssistantMessage([fauxText("来一次词汇小测：\n"), fauxToolCall("start_practice", { type: "vocabulary", count: 2 })], {
			stopReason: "toolUse",
		});
	}
	return fauxAssistantMessage(
		"这是例句：Persistence is the key to learning English.（坚持不懈是学英语的关键）\n\n（演示模式：回复由 fauxProvider 脚本化。配置真实 API key 后即为真实模型）",
		{ stopReason: "stop" },
	);
};

const WEB_PACKS: WebPack[] = [
	{
		id: "code",
		name: "编程",
		tagline: "写代码、跑程序，在真实输出中学会编程。",
		suggestions: [
			"写一个打印斐波那契数列前 10 项的 Python 程序并运行给我看",
			"@feynman 什么是闭包？太抽象了，打个比方",
			"@oris 我想学 Django，但连 HTTP 都不太懂，该从哪开始？",
		],
		profiles: getDefaultCodeProfiles(),
		create: (config) => createCodeMentorSession(config),
		panel: (session) => {
			const s = session as CodeMentorSession;
			return { kind: "files", files: s.listFiles().map((p) => ({ path: p, content: s.readFile(p) ?? "" })) };
		},
	},
	{
		id: "english",
		name: "英语",
		tagline: "积累词汇、讲解语法、做针对性练习。",
		suggestions: [
			"教我记住 persistence 这个词，给个例句",
			"@wren 我想系统学一下现在完成时",
			"@rina 来一组词汇练习，考考我",
		],
		profiles: getDefaultEnglishProfiles(),
		create: (config) => createEnglishMentorSession(config),
		panel: (session) => {
			const s = session as EnglishMentorSession;
			return { kind: "vocabulary", words: s.listWords() };
		},
	},
];

function getPack(id: string): WebPack {
	const pack = WEB_PACKS.find((p) => p.id === id);
	if (!pack) throw new Error(`未知 pack: ${id}`);
	return pack;
}

/* ---------- 会话存储：Postgres（加密）优先，缺配置/不可用时回退进程内 ---------- */

/** Web 演示适配层是单用户场景，身份固定；courseId 用来按 pack 分桶。 */
function identityFor(packId: string): SessionIdentity {
	return { tenantId: "web", userId: "local", courseId: packId };
}

interface SessionEntry {
	session: PackSession;
	pack: WebPack;
	/** 与存储一致的 revision；beginRun/completeRun 的乐观锁基准。 */
	revision: number;
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
	// 演示模式下每个 pack 注入独立的 faux 模型脚本（code 额外注入进程内 exec）
	const demoOptionsCache = new Map<string, SessionCreateConfig>();
	const optionsFor = (pack: WebPack): SessionCreateConfig => {
		if (!FAUX_DEMO) return {};
		const cached = demoOptionsCache.get(pack.id);
		if (cached) return cached;
		const options: SessionCreateConfig =
			pack.id === "english"
				? { models: createFauxModels(nextEnglishDemoStep), providerId: "faux", modelId: "faux-1", useEnvCustomModel: false }
				: { models: createFauxModels(nextCodeDemoStep), providerId: "faux", modelId: "faux-1", useEnvCustomModel: false, exec: demoExec };
		demoOptionsCache.set(pack.id, options);
		return options;
	};

	const { store, backend } = await createSessionStore(FAUX_DEMO);
	console.log(`[web] 会话持久化: ${backend === "postgres" ? "PostgreSQL（AES-256-GCM）" : "进程内存（重启后丢失）"}`);

	// 已加载会话的进程内缓存；未命中时从存储解密恢复
	const entries = new Map<string, SessionEntry>();

	async function getEntry(sessionId: string): Promise<SessionEntry> {
		const cached = entries.get(sessionId);
		if (cached) return cached;
		const stored = await store.load(sessionId);
		if (!stored) throw new SessionNotFoundError(sessionId);
		const pack = getPack(stored.courseId ?? "code");
		const entry: SessionEntry = {
			session: pack.create({ ...optionsFor(pack), snapshot: stored.snapshot as SessionSnapshotV1 }),
			pack,
			revision: stored.revision,
		};
		entries.set(sessionId, entry);
		return entry;
	}

	const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const sessionIdParam = url.searchParams.get("id") ?? "";
		try {
			if (req.method === "GET" && url.pathname === "/api/packs") {
				json(res, 200, {
					packs: WEB_PACKS.map((pack) => ({
						id: pack.id,
						name: pack.name,
						tagline: pack.tagline,
						suggestions: pack.suggestions,
						profiles: pack.profiles.map((p) => ({ key: p.key, name: p.name })),
					})),
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/sessions") {
				const packId = url.searchParams.get("pack") ?? "code";
				const pack = getPack(packId);
				const summaries = await store.list(identityFor(packId));
				json(res, 200, {
					storage: backend,
					pack: pack.id,
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
				const body = await readJsonBody(req);
				const packId = typeof body.pack === "string" && body.pack ? body.pack : "code";
				const pack = getPack(packId);
				const empty: SessionSnapshotV1 = { version: 1, revision: 0, activeProfileKey: null, activeToolsetKeys: [], messages: [], extensions: {} };
				const created = await store.create({ identity: identityFor(packId), snapshot: empty });
				entries.set(created.id, { session: pack.create({ ...optionsFor(pack), snapshot: created.snapshot as SessionSnapshotV1 }), pack, revision: 0 });
				json(res, 200, { sessionId: created.id, pack: packId });
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
				const messages = snapshot.messages.flatMap((raw): Array<{ role: "user" | "assistant"; text: string }> => {
					const message = raw as { role?: unknown; content?: unknown };
					if (message.role !== "user" && message.role !== "assistant") return [];
					const text = textOfContent(message.content);
					if (!text.trim()) return [];
					return [{ role: message.role, text }];
				});
				json(res, 200, { sessionId: sessionIdParam, pack: entry.pack.id, profile: entry.session.profile, messages });
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
					pack: entry.pack.id,
					packName: entry.pack.name,
					profile: entry.session.profile
						? { key: entry.session.profile, name: entry.pack.profiles.find((p) => p.key === entry.session.profile)?.name ?? entry.session.profile }
						: null,
					model: entry.session.modelInfo,
					demo: FAUX_DEMO,
					storage: backend,
					profiles: entry.pack.profiles.map((p) => ({ key: p.key, name: p.name })),
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/panel") {
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
				json(res, 200, { pack: entry.pack.id, ...entry.pack.panel(entry.session) });
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
			if (req.method === "POST" && url.pathname === "/api/profile") {
				const body = await readJsonBody(req);
				const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
				if (!sessionId) {
					json(res, 400, { error: "missing sessionId" });
					return;
				}
				let entry: SessionEntry;
				try {
					entry = await getEntry(sessionId);
				} catch (err) {
					storeErrorResponse(res, err);
					return;
				}
				const p = body.profile;
				if (p !== null && (typeof p !== "string" || !entry.pack.profiles.some((profile) => profile.key === p))) {
					json(res, 400, { error: `profile 需为 ${entry.pack.profiles.map((profile) => profile.key).join("/")} 或 null` });
					return;
				}
				entry.session.setProfile(p as string | null);
				json(res, 200, {
					ok: true,
					profile: entry.session.profile,
					name: entry.pack.profiles.find((profile) => profile.key === entry.session.profile)?.name ?? null,
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
						profileKey: entry.session.profile ?? undefined,
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
				const send = (event: SessionEvent) => {
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

	// 默认 9600：8100/8600 常落在 WSL2/Hyper-V 保留端口段（本机实测 8519-8618 整段 EACCES）；
	// 未显式指定 WEB_PORT 时自动回退尝试后续端口，保证 npm run web 总能起来
	const explicitPort = process.env.WEB_PORT !== undefined;
	const port = Number(process.env.WEB_PORT ?? 9600);
	const candidates = explicitPort ? [port] : Array.from({ length: 20 }, (_, i) => port + i);

	startServer(handler, candidates, FAUX_DEMO);
}

export { main };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((err) => {
	console.error("[web] 启动失败:", err);
	process.exit(1);
});
