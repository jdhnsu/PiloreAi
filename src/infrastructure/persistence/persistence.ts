import type { SessionSnapshot } from "../../core/types.js";
import type { TrajectoryRun } from "../../core/trajectory/types.js";
export type StoredSnapshot = SessionSnapshot;

export interface SessionIdentity {
	tenantId: string;
	userId: string;
	courseId?: string;
}

export interface StoredSession extends SessionIdentity {
	id: string;
	revision: number;
	/** 首条用户消息摘要；创建时通常为空，首轮完成后由存储派生。 */
	title: string;
	snapshot: StoredSnapshot;
	activeRunId?: string;
	createdAt: Date;
	updatedAt: Date;
}

/** 会话列表条目：不含快照密文，服务端可直接用于历史侧边栏。 */
export interface SessionSummary {
	id: string;
	tenantId: string;
	userId: string;
	courseId?: string;
	revision: number;
	title: string;
	activeRunId?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface RunAuditPayload {
	input: string;
	output?: string;
	toolResults?: Array<{ toolName: string; isError: boolean; text: string }>;
}

export interface RunMetrics {
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	[key: string]: string | number | boolean | null | undefined;
}

export interface StoredRun {
	id: string;
	sessionId: string;
	status: "running" | "completed" | "failed";
	providerId: string;
	modelId: string;
	profileKey?: string;
	startedAt: Date;
	completedAt?: Date;
}

export interface CreateStoredSession {
	id?: string;
	identity: SessionIdentity;
	snapshot: StoredSnapshot;
}

export interface BeginRunInput {
	id?: string;
	sessionId: string;
	expectedRevision: number;
	providerId: string;
	modelId: string;
	profileKey?: string;
	audit: RunAuditPayload;
}

export interface CompleteRunInput {
	runId: string;
	sessionId: string;
	expectedRevision: number;
	snapshot: StoredSnapshot;
	audit: RunAuditPayload;
	metrics?: RunMetrics;
}

export interface FailRunInput {
	runId: string;
	sessionId: string;
	errorCode: string;
	audit?: RunAuditPayload;
	metrics?: RunMetrics;
}

/** One trajectory record persisted beside its owning run. */
export interface SaveTrajectoryInput {
	runId: string;
	sessionId: string;
	run: TrajectoryRun;
}

export interface SessionStore {
	create(input: CreateStoredSession): Promise<StoredSession>;
	load(sessionId: string): Promise<StoredSession | undefined>;
	/** 按身份列出会话（不含快照），按 updatedAt 降序，实现上限 100 条。 */
	list(identity: SessionIdentity): Promise<SessionSummary[]>;
	beginRun(input: BeginRunInput): Promise<StoredRun>;
	completeRun(input: CompleteRunInput): Promise<StoredSession>;
	failRun(input: FailRunInput): Promise<void>;
	/** 保存一次运行的结构化轨迹；对应 run 必须已存在。 */
	saveTrajectory(input: SaveTrajectoryInput): Promise<void>;
	/** 读取某会话的轨迹记录，按运行开始时间升序。 */
	loadTrajectory(sessionId: string): Promise<TrajectoryRun[]>;
	delete(sessionId: string): Promise<void>;
	/** 记录登录用户及其显示名（displayName 为 null 时保留原值），用于内测归因。 */
	upsertUser(userId: string, displayName: string | null): Promise<void>;
	/** 读取用户显示名；不存在返回 null。 */
	getUserDisplayName(userId: string): Promise<string | null>;
}

/** 从快照的首条用户消息派生会话标题（空白折叠、截断到 maxLength）。 */
export function deriveSessionTitle(snapshot: StoredSnapshot, maxLength = 40): string {
	for (const message of snapshot.messages as Array<{ role?: unknown; content?: unknown }>) {
		if (message.role !== "user") continue;
		const text =
			typeof message.content === "string"
				? message.content
				: (message.content as Array<{ type?: unknown; text?: unknown }>)
						.filter((block) => block?.type === "text" && typeof block.text === "string")
						.map((block) => block.text as string)
						.join(" ");
		const title = text.replace(/\s+/g, " ").trim().slice(0, maxLength);
		if (title) return title;
	}
	return "";
}

export class SessionStoreError extends Error {
	constructor(
		message: string,
		readonly code: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "SessionStoreError";
	}
}

export class SessionNotFoundError extends SessionStoreError {
	constructor(sessionId: string) {
		super(`会话不存在: ${sessionId}`, "SESSION_NOT_FOUND");
		this.name = "SessionNotFoundError";
	}
}

export class SessionBusyError extends SessionStoreError {
	constructor(sessionId: string) {
		super(`会话正在执行另一轮请求: ${sessionId}`, "SESSION_BUSY");
		this.name = "SessionBusyError";
	}
}

export class SessionRevisionConflictError extends SessionStoreError {
	constructor(sessionId: string, expectedRevision: number) {
		super(`会话 ${sessionId} 的 revision 已变化（期望 ${expectedRevision}）`, "SESSION_REVISION_CONFLICT");
		this.name = "SessionRevisionConflictError";
	}
}
