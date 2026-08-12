import { randomUUID } from "node:crypto";
import {
	deriveSessionTitle,
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	SessionStoreError,
	type BeginRunInput,
	type CompleteRunInput,
	type CreateStoredSession,
	type FailRunInput,
	type RunAuditPayload,
	type SessionIdentity,
	type SessionStore,
	type SessionSummary,
	type StoredRun,
	type StoredSession,
} from "./persistence.js";
import { cloneSessionSnapshot, EDU_SESSION_SNAPSHOT_VERSION } from "./snapshot.js";

interface MemoryRun extends StoredRun {
	audit: RunAuditPayload;
	errorCode?: string;
}

function assertSupportedVersion(snapshot: { version: number }): void {
	if (snapshot.version !== 1 && snapshot.version !== EDU_SESSION_SNAPSHOT_VERSION) {
		throw new SessionStoreError(`不支持的快照版本: ${snapshot.version}`, "UNSUPPORTED_SNAPSHOT_VERSION");
	}
}

/**
 * 进程内 SessionStore：与 PostgresSessionStore 同语义（revision/互斥/标题派生），
 * 用于演示与未配置数据库时的回退；进程退出即丢失。
 */
export class InMemorySessionStore implements SessionStore {
	private readonly sessions = new Map<string, StoredSession>();
	private readonly runs = new Map<string, MemoryRun>();

	async create(input: CreateStoredSession): Promise<StoredSession> {
		const id = input.id ?? randomUUID();
		if (this.sessions.has(id)) throw new SessionStoreError(`会话已存在: ${id}`, "SESSION_EXISTS");
		assertSupportedVersion(input.snapshot);
		if (input.snapshot.revision !== 0) throw new SessionStoreError("新会话 snapshot.revision 必须为 0", "INVALID_INITIAL_REVISION");
		const now = new Date();
		const stored: StoredSession = {
			id,
			tenantId: input.identity.tenantId,
			userId: input.identity.userId,
			...(input.identity.courseId ? { courseId: input.identity.courseId } : {}),
			revision: 0,
			title: deriveSessionTitle(input.snapshot),
			snapshot: cloneSessionSnapshot(input.snapshot),
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.set(id, stored);
		return this.cloneStored(stored);
	}

	async load(sessionId: string): Promise<StoredSession | undefined> {
		const stored = this.sessions.get(sessionId);
		return stored ? this.cloneStored(stored) : undefined;
	}

	async list(identity: SessionIdentity): Promise<SessionSummary[]> {
		const summaries: SessionSummary[] = [];
		for (const stored of this.sessions.values()) {
			if (stored.tenantId !== identity.tenantId || stored.userId !== identity.userId) continue;
			if ((stored.courseId ?? null) !== (identity.courseId ?? null)) continue;
			summaries.push({
				id: stored.id,
				tenantId: stored.tenantId,
				userId: stored.userId,
				...(stored.courseId ? { courseId: stored.courseId } : {}),
				revision: stored.revision,
				title: stored.title,
				...(stored.activeRunId ? { activeRunId: stored.activeRunId } : {}),
				createdAt: new Date(stored.createdAt),
				updatedAt: new Date(stored.updatedAt),
			});
		}
		return summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 100);
	}

	async beginRun(input: BeginRunInput): Promise<StoredRun> {
		const stored = this.sessions.get(input.sessionId);
		if (!stored) throw new SessionNotFoundError(input.sessionId);
		if (stored.revision !== input.expectedRevision) throw new SessionRevisionConflictError(input.sessionId, input.expectedRevision);
		if (stored.activeRunId) throw new SessionBusyError(input.sessionId);
		const run: MemoryRun = {
			id: input.id ?? randomUUID(),
			sessionId: input.sessionId,
			status: "running",
			providerId: input.providerId,
			modelId: input.modelId,
			...(input.personaKey ? { personaKey: input.personaKey } : {}),
			startedAt: new Date(),
			audit: input.audit,
		};
		this.runs.set(run.id, run);
		stored.activeRunId = run.id;
		stored.updatedAt = new Date();
		return this.cloneRun(run);
	}

	async completeRun(input: CompleteRunInput): Promise<StoredSession> {
		const stored = this.sessions.get(input.sessionId);
		if (!stored) throw new SessionNotFoundError(input.sessionId);
		if (stored.revision !== input.expectedRevision) throw new SessionRevisionConflictError(input.sessionId, input.expectedRevision);
		if (stored.activeRunId !== input.runId) throw new SessionStoreError(`run ${input.runId} 不是会话当前活动运行`, "RUN_NOT_ACTIVE");
		const run = this.runs.get(input.runId);
		if (!run || run.status !== "running") throw new SessionStoreError(`run ${input.runId} 无法完成`, "RUN_NOT_RUNNING");
		assertSupportedVersion(input.snapshot);
		stored.revision = input.expectedRevision + 1;
		stored.snapshot = cloneSessionSnapshot({ ...input.snapshot, revision: stored.revision });
		if (!stored.title) stored.title = deriveSessionTitle(stored.snapshot);
		stored.activeRunId = undefined;
		stored.updatedAt = new Date();
		run.status = "completed";
		run.completedAt = new Date();
		run.audit = input.audit;
		return this.cloneStored(stored);
	}

	async failRun(input: FailRunInput): Promise<void> {
		const stored = this.sessions.get(input.sessionId);
		if (!stored) throw new SessionNotFoundError(input.sessionId);
		if (stored.activeRunId !== input.runId) throw new SessionStoreError(`run ${input.runId} 不是会话当前活动运行`, "RUN_NOT_ACTIVE");
		const run = this.runs.get(input.runId);
		if (!run || run.status !== "running") throw new SessionStoreError(`run ${input.runId} 无法标记失败`, "RUN_NOT_RUNNING");
		run.status = "failed";
		run.errorCode = input.errorCode;
		run.completedAt = new Date();
		if (input.audit) run.audit = input.audit;
		stored.activeRunId = undefined;
		stored.updatedAt = new Date();
	}

	async delete(sessionId: string): Promise<void> {
		this.sessions.delete(sessionId);
		for (const [runId, run] of this.runs) {
			if (run.sessionId === sessionId) this.runs.delete(runId);
		}
	}

	private cloneStored(stored: StoredSession): StoredSession {
		return {
			id: stored.id,
			tenantId: stored.tenantId,
			userId: stored.userId,
			...(stored.courseId ? { courseId: stored.courseId } : {}),
			revision: stored.revision,
			title: stored.title,
			snapshot: cloneSessionSnapshot(stored.snapshot),
			...(stored.activeRunId ? { activeRunId: stored.activeRunId } : {}),
			createdAt: new Date(stored.createdAt),
			updatedAt: new Date(stored.updatedAt),
		};
	}

	private cloneRun(run: MemoryRun): StoredRun {
		return {
			id: run.id,
			sessionId: run.sessionId,
			status: run.status,
			providerId: run.providerId,
			modelId: run.modelId,
			...(run.personaKey ? { personaKey: run.personaKey } : {}),
			startedAt: new Date(run.startedAt),
			...(run.completedAt ? { completedAt: new Date(run.completedAt) } : {}),
		};
	}
}

export function createInMemorySessionStore(): SessionStore {
	return new InMemorySessionStore();
}
