import type { EduSessionSnapshotV1 } from "./snapshot.js";

export interface SessionIdentity {
	tenantId: string;
	userId: string;
	courseId?: string;
}

export interface StoredSession extends SessionIdentity {
	id: string;
	revision: number;
	snapshot: EduSessionSnapshotV1;
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
	personaKey?: string;
	startedAt: Date;
	completedAt?: Date;
}

export interface CreateStoredSession {
	id?: string;
	identity: SessionIdentity;
	snapshot: EduSessionSnapshotV1;
}

export interface BeginRunInput {
	id?: string;
	sessionId: string;
	expectedRevision: number;
	providerId: string;
	modelId: string;
	personaKey?: string;
	audit: RunAuditPayload;
}

export interface CompleteRunInput {
	runId: string;
	sessionId: string;
	expectedRevision: number;
	snapshot: EduSessionSnapshotV1;
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

export interface SessionStore {
	create(input: CreateStoredSession): Promise<StoredSession>;
	load(sessionId: string): Promise<StoredSession | undefined>;
	beginRun(input: BeginRunInput): Promise<StoredRun>;
	completeRun(input: CompleteRunInput): Promise<StoredSession>;
	failRun(input: FailRunInput): Promise<void>;
	delete(sessionId: string): Promise<void>;
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
