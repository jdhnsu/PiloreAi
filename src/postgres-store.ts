import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CryptoContext, CryptoProvider, EncryptedPayload } from "./crypto.js";
import {
	SessionBusyError,
	SessionNotFoundError,
	SessionRevisionConflictError,
	SessionStoreError,
	type BeginRunInput,
	type CompleteRunInput,
	type CreateStoredSession,
	type FailRunInput,
	type RunAuditPayload,
	type SessionStore,
	type StoredRun,
	type StoredSession,
} from "./persistence.js";
import { EDU_SESSION_SNAPSHOT_VERSION, type EduSessionSnapshotV1 } from "./snapshot.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const POSTGRES_MIGRATION_001 = `
CREATE SCHEMA IF NOT EXISTS pilore;

CREATE TABLE IF NOT EXISTS pilore.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pilore.sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  course_id text,
  revision bigint NOT NULL CHECK (revision >= 0),
  snapshot_version integer NOT NULL,
  snapshot_algorithm text NOT NULL,
  snapshot_ciphertext bytea NOT NULL,
  snapshot_nonce bytea NOT NULL,
  snapshot_key_id text NOT NULL,
  active_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_identity_idx
  ON pilore.sessions (tenant_id, user_id, course_id);

CREATE TABLE IF NOT EXISTS pilore.runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES pilore.sessions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  provider_id text NOT NULL,
  model_id text NOT NULL,
  persona_key text,
  audit_algorithm text NOT NULL,
  audit_ciphertext bytea NOT NULL,
  audit_nonce bytea NOT NULL,
  audit_key_id text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS runs_session_started_idx
  ON pilore.runs (session_id, started_at DESC);
`;

function resolveSchema(schema = "pilore"): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new SessionStoreError(`非法 PostgreSQL schema: ${schema}`, "INVALID_SCHEMA");
	return `"${schema}"`;
}

export async function applyPostgresMigrations(pool: Pool, options: { schema?: string } = {}): Promise<void> {
	const schema = resolveSchema(options.schema);
	const migration = POSTGRES_MIGRATION_001.replace("CREATE SCHEMA IF NOT EXISTS pilore", `CREATE SCHEMA IF NOT EXISTS ${schema}`).replaceAll(
		"pilore.",
		`${schema}.`,
	);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
		await client.query(
			`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
		);
		const applied = await client.query<{ version: number }>(`SELECT version FROM ${schema}.schema_migrations WHERE version = 1`);
		if (applied.rowCount === 0) {
			await client.query(migration);
			await client.query(`INSERT INTO ${schema}.schema_migrations(version) VALUES (1)`);
		}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

interface SessionRow {
	id: string;
	tenant_id: string;
	user_id: string;
	course_id: string | null;
	revision: string;
	snapshot_version: number;
	snapshot_algorithm: string;
	snapshot_ciphertext: Buffer;
	snapshot_nonce: Buffer;
	snapshot_key_id: string;
	active_run_id: string | null;
	created_at: Date;
	updated_at: Date;
}

interface RunRow {
	id: string;
	session_id: string;
	status: "running" | "completed" | "failed";
	provider_id: string;
	model_id: string;
	persona_key: string | null;
	started_at: Date;
	completed_at: Date | null;
}

function context(
	tenantId: string,
	sessionId: string,
	revision: number,
	purpose: CryptoContext["purpose"],
	schemaVersion: number = EDU_SESSION_SNAPSHOT_VERSION,
): CryptoContext {
	return { tenantId, sessionId, revision, schemaVersion, purpose };
}

function encode(value: unknown): Uint8Array {
	return encoder.encode(JSON.stringify(value));
}

function encryptedColumns(payload: EncryptedPayload): [string, Buffer, Buffer, string] {
	return [payload.algorithm, Buffer.from(payload.ciphertext), Buffer.from(payload.nonce), payload.keyId];
}

async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await body(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export interface PostgresSessionStoreOptions {
	pool: Pool;
	crypto: CryptoProvider;
	/** 默认 pilore；主要用于测试隔离或同实例部署多个独立 Runtime。 */
	schema?: string;
}

export class PostgresSessionStore implements SessionStore {
	private readonly schema: string;

	constructor(private readonly options: PostgresSessionStoreOptions) {
		this.schema = resolveSchema(options.schema);
	}

	private async decodeSession(row: SessionRow): Promise<StoredSession> {
		const revision = Number(row.revision);
		if (!Number.isSafeInteger(revision)) throw new SessionStoreError(`数据库 revision 超出安全整数范围: ${row.revision}`, "INVALID_REVISION");
		const plaintext = await this.options.crypto.decrypt(
			{
				algorithm: row.snapshot_algorithm as EncryptedPayload["algorithm"],
				keyId: row.snapshot_key_id,
				nonce: row.snapshot_nonce,
				ciphertext: row.snapshot_ciphertext,
			},
			context(row.tenant_id, row.id, revision, "snapshot", row.snapshot_version),
		);
		let snapshot: EduSessionSnapshotV1;
		try {
			snapshot = JSON.parse(decoder.decode(plaintext)) as EduSessionSnapshotV1;
		} catch (cause) {
			throw new SessionStoreError(`会话 ${row.id} 的快照 JSON 已损坏`, "INVALID_SNAPSHOT_JSON", { cause });
		}
		if (snapshot.version !== row.snapshot_version || snapshot.revision !== revision) {
			throw new SessionStoreError(`会话 ${row.id} 的快照元数据不一致`, "SNAPSHOT_METADATA_MISMATCH");
		}
		return {
			id: row.id,
			tenantId: row.tenant_id,
			userId: row.user_id,
			...(row.course_id ? { courseId: row.course_id } : {}),
			revision,
			snapshot,
			...(row.active_run_id ? { activeRunId: row.active_run_id } : {}),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async create(input: CreateStoredSession): Promise<StoredSession> {
		const id = input.id ?? randomUUID();
		if (input.snapshot.version !== EDU_SESSION_SNAPSHOT_VERSION) {
			throw new SessionStoreError(`不支持的快照版本: ${input.snapshot.version}`, "UNSUPPORTED_SNAPSHOT_VERSION");
		}
		if (input.snapshot.revision !== 0) throw new SessionStoreError("新会话 snapshot.revision 必须为 0", "INVALID_INITIAL_REVISION");
		const payload = await this.options.crypto.encrypt(
			encode(input.snapshot),
			context(input.identity.tenantId, id, 0, "snapshot", input.snapshot.version),
		);
		const [algorithm, ciphertext, nonce, keyId] = encryptedColumns(payload);
		const result = await this.options.pool.query<SessionRow>(
			`INSERT INTO ${this.schema}.sessions
			 (id, tenant_id, user_id, course_id, revision, snapshot_version, snapshot_algorithm, snapshot_ciphertext, snapshot_nonce, snapshot_key_id)
			 VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)
			 RETURNING *`,
			[id, input.identity.tenantId, input.identity.userId, input.identity.courseId ?? null, input.snapshot.version, algorithm, ciphertext, nonce, keyId],
		);
		return this.decodeSession(result.rows[0]);
	}

	async load(sessionId: string): Promise<StoredSession | undefined> {
		const result = await this.options.pool.query<SessionRow>(`SELECT * FROM ${this.schema}.sessions WHERE id = $1`, [sessionId]);
		return result.rows[0] ? this.decodeSession(result.rows[0]) : undefined;
	}

	async beginRun(input: BeginRunInput): Promise<StoredRun> {
		return transaction(this.options.pool, async (client) => {
			const sessionResult = await client.query<Pick<SessionRow, "tenant_id" | "revision" | "active_run_id">>(
				`SELECT tenant_id, revision, active_run_id FROM ${this.schema}.sessions WHERE id = $1 FOR UPDATE`,
				[input.sessionId],
			);
			const session = sessionResult.rows[0];
			if (!session) throw new SessionNotFoundError(input.sessionId);
			if (Number(session.revision) !== input.expectedRevision) throw new SessionRevisionConflictError(input.sessionId, input.expectedRevision);
			if (session.active_run_id) throw new SessionBusyError(input.sessionId);
			const runId = input.id ?? randomUUID();
			const audit = await this.options.crypto.encrypt(
				encode(input.audit),
				context(session.tenant_id, input.sessionId, input.expectedRevision, "run"),
			);
			const [algorithm, ciphertext, nonce, keyId] = encryptedColumns(audit);
			const runResult = await client.query<RunRow>(
				`INSERT INTO ${this.schema}.runs
				 (id, session_id, status, provider_id, model_id, persona_key, audit_algorithm, audit_ciphertext, audit_nonce, audit_key_id)
				 VALUES ($1, $2, 'running', $3, $4, $5, $6, $7, $8, $9)
				 RETURNING id, session_id, status, provider_id, model_id, persona_key, started_at, completed_at`,
				[runId, input.sessionId, input.providerId, input.modelId, input.personaKey ?? null, algorithm, ciphertext, nonce, keyId],
			);
			await client.query(`UPDATE ${this.schema}.sessions SET active_run_id = $2, updated_at = now() WHERE id = $1`, [input.sessionId, runId]);
			return this.mapRun(runResult.rows[0]);
		});
	}

	async completeRun(input: CompleteRunInput): Promise<StoredSession> {
		const row = await transaction(this.options.pool, async (client) => {
			const sessionResult = await client.query<SessionRow>(`SELECT * FROM ${this.schema}.sessions WHERE id = $1 FOR UPDATE`, [input.sessionId]);
			const session = sessionResult.rows[0];
			if (!session) throw new SessionNotFoundError(input.sessionId);
			if (Number(session.revision) !== input.expectedRevision) throw new SessionRevisionConflictError(input.sessionId, input.expectedRevision);
			if (session.active_run_id !== input.runId) throw new SessionStoreError(`run ${input.runId} 不是会话当前活动运行`, "RUN_NOT_ACTIVE");

			const nextRevision = input.expectedRevision + 1;
			if (!Number.isSafeInteger(nextRevision)) throw new SessionStoreError("revision 超出安全整数范围", "INVALID_REVISION");
			const snapshot: EduSessionSnapshotV1 = { ...input.snapshot, revision: nextRevision };
			if (snapshot.version !== EDU_SESSION_SNAPSHOT_VERSION) {
				throw new SessionStoreError(`不支持的快照版本: ${snapshot.version}`, "UNSUPPORTED_SNAPSHOT_VERSION");
			}
			const [snapshotPayload, auditPayload] = await Promise.all([
				this.options.crypto.encrypt(encode(snapshot), context(session.tenant_id, input.sessionId, nextRevision, "snapshot", snapshot.version)),
				this.options.crypto.encrypt(encode(input.audit), context(session.tenant_id, input.sessionId, nextRevision, "run")),
			]);
			const [snapshotAlgorithm, snapshotCiphertext, snapshotNonce, snapshotKeyId] = encryptedColumns(snapshotPayload);
			const [auditAlgorithm, auditCiphertext, auditNonce, auditKeyId] = encryptedColumns(auditPayload);
			const updated = await client.query<SessionRow>(
				`UPDATE ${this.schema}.sessions SET
				 revision = $3, snapshot_version = $4, snapshot_algorithm = $5, snapshot_ciphertext = $6,
				 snapshot_nonce = $7, snapshot_key_id = $8, active_run_id = NULL, updated_at = now()
				 WHERE id = $1 AND revision = $2 AND active_run_id = $9 RETURNING *`,
				[input.sessionId, String(input.expectedRevision), String(nextRevision), snapshot.version, snapshotAlgorithm, snapshotCiphertext, snapshotNonce, snapshotKeyId, input.runId],
			);
			if (!updated.rows[0]) throw new SessionRevisionConflictError(input.sessionId, input.expectedRevision);
			const runUpdated = await client.query(
				`UPDATE ${this.schema}.runs SET status = 'completed', audit_algorithm = $2, audit_ciphertext = $3,
				 audit_nonce = $4, audit_key_id = $5, metrics = $6::jsonb, completed_at = now()
				 WHERE id = $1 AND session_id = $7 AND status = 'running'`,
				[input.runId, auditAlgorithm, auditCiphertext, auditNonce, auditKeyId, JSON.stringify(input.metrics ?? {}), input.sessionId],
			);
			if (runUpdated.rowCount !== 1) throw new SessionStoreError(`run ${input.runId} 无法完成`, "RUN_NOT_RUNNING");
			return updated.rows[0];
		});
		return this.decodeSession(row);
	}

	async failRun(input: FailRunInput): Promise<void> {
		await transaction(this.options.pool, async (client) => {
			const sessionResult = await client.query<Pick<SessionRow, "tenant_id" | "revision" | "active_run_id">>(
				`SELECT tenant_id, revision, active_run_id FROM ${this.schema}.sessions WHERE id = $1 FOR UPDATE`,
				[input.sessionId],
			);
			const session = sessionResult.rows[0];
			if (!session) throw new SessionNotFoundError(input.sessionId);
			if (session.active_run_id !== input.runId) throw new SessionStoreError(`run ${input.runId} 不是会话当前活动运行`, "RUN_NOT_ACTIVE");
			let auditSql = "";
			const values: unknown[] = [input.runId, input.sessionId, input.errorCode, JSON.stringify(input.metrics ?? {})];
			if (input.audit) {
				const revision = Number(session.revision);
				const encrypted = await this.options.crypto.encrypt(encode(input.audit), context(session.tenant_id, input.sessionId, revision, "run"));
				const [algorithm, ciphertext, nonce, keyId] = encryptedColumns(encrypted);
				auditSql = ", audit_algorithm = $5, audit_ciphertext = $6, audit_nonce = $7, audit_key_id = $8";
				values.push(algorithm, ciphertext, nonce, keyId);
			}
			const updated = await client.query(
				`UPDATE ${this.schema}.runs SET status = 'failed', error_code = $3, metrics = $4::jsonb,
				 completed_at = now()${auditSql} WHERE id = $1 AND session_id = $2 AND status = 'running'`,
				values,
			);
			if (updated.rowCount !== 1) throw new SessionStoreError(`run ${input.runId} 无法标记失败`, "RUN_NOT_RUNNING");
			await client.query(`UPDATE ${this.schema}.sessions SET active_run_id = NULL, updated_at = now() WHERE id = $1 AND active_run_id = $2`, [
				input.sessionId,
				input.runId,
			]);
		});
	}

	async delete(sessionId: string): Promise<void> {
		await this.options.pool.query(`DELETE FROM ${this.schema}.sessions WHERE id = $1`, [sessionId]);
	}

	private mapRun(row: RunRow): StoredRun {
		return {
			id: row.id,
			sessionId: row.session_id,
			status: row.status,
			providerId: row.provider_id,
			modelId: row.model_id,
			...(row.persona_key ? { personaKey: row.persona_key } : {}),
			startedAt: row.started_at,
			...(row.completed_at ? { completedAt: row.completed_at } : {}),
		};
	}
}

export function createPostgresSessionStore(options: PostgresSessionStoreOptions): SessionStore {
	return new PostgresSessionStore(options);
}
