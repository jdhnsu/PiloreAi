/**
 * 组件公开入口：迁移到其它项目时只需依赖这里导出的 API。
 *
 * 最小嵌入路径：`createEduSession(config)` —— 见 README「作为库嵌入」。
 * import 本入口不产生任何副作用（不扫磁盘、不读 env、不发请求），
 * 内置老师目录与执行后端在创建会话/agent 时按需解析。
 */
export { createEduSession, type EduEvent, type EduSession, type EduSessionOptions } from "./session.js";
export { createRuntime, type Runtime } from "./core/runtime.js";
export { createSession, type Session, type SessionConfig } from "./core/session.js";
export { CoreState } from "./core/state.js";
export { CORE_SESSION_SNAPSHOT_VERSION, validateCoreSnapshot, cloneCoreSnapshot } from "./core/snapshot.js";
export type { JsonValue, Profile, DomainPack, ToolPack, RuntimeConfig, SessionEvent, SessionSnapshot, SessionSnapshotV1 } from "./core/types.js";
export type { ProfileDefinition, RouterConfig, ToolGroup, ToolManifest, SnapshotExtension } from "./core/types.js";
export { appendProfileContext, convertProfileMessages, createProfileContext, createUpdateProfileStateTool, hashProfile, isProfileContext, type ProfileContextMessage } from "./core/router/index.js";
export { INTERNAL_TOOL_NAMES, createActivateToolsetTool, toolsForState, validateToolManifest } from "./core/tool-runtime/index.js";
export { createRouterTool } from "./core/router/index.js";
export * from "./packs/code/index.js";
export {
	createAgent,
	buildBasePrompt,
	getSystemPrompt,
	buildPersonaPrompt,
	buildPiLorePrompt,
	type CreateAgentOptions,
	type EduAgent,
} from "./agent.js";
export type { EduAgentConfig } from "./interfaces.js";
export {
	createObservedStreamFn,
	type LlmTelemetryEvent,
	type LlmTelemetrySink,
	type ObservedStreamOptions,
} from "./telemetry.js";
export * from "./models/index.js";
export {
	parsePersona,
	loadPersonasFromDir,
	getDefaultPersonas,
	getPersonaKeys,
	getPersona,
	resolveMention,
	buildCatalog,
	availablePersonasText,
	type Persona,
	type PersonaKey,
	type PersonaMeta,
	type PersonaCapabilities,
} from "./personas.js";
export { SharedState, MAX_SWITCHES_PER_TURN, type TeachingProgress, type PersonaSource } from "./shared-state.js";
export {
	EDU_SESSION_SNAPSHOT_VERSION,
	validateSessionSnapshot,
	cloneSessionSnapshot,
	InvalidSessionSnapshotError,
	type EduSessionSnapshot,
	type EduSessionSnapshotV1,
	type EduSessionSnapshotV2,
} from "./snapshot.js";
export {
	appendPersonaContext,
	convertPiLoreMessages,
	createPersonaContextMessage,
	hashPersona,
	hashPersonaMethodology,
	isPersonaContextMessage,
	renderPersonaContext,
	type PersonaContextMessage,
} from "./persona-context.js";
export {
	createAes256GcmCryptoProvider,
	CryptoProviderError,
	type CryptoProvider,
	type CryptoContext,
	type EncryptedPayload,
	type Aes256GcmCryptoOptions,
} from "./crypto.js";
export {
	deriveSessionTitle,
	SessionStoreError,
	SessionNotFoundError,
	SessionBusyError,
	SessionRevisionConflictError,
	type SessionStore,
	type SessionIdentity,
	type SessionSummary,
	type StoredSession,
	type StoredRun,
	type RunAuditPayload,
	type RunMetrics,
	type CreateStoredSession,
	type BeginRunInput,
	type CompleteRunInput,
	type FailRunInput,
} from "./persistence.js";
export { InMemorySessionStore, createInMemorySessionStore } from "./memory-store.js";
export {
	POSTGRES_MIGRATION_001,
	applyPostgresMigrations,
	PostgresSessionStore,
	createPostgresSessionStore,
	type PostgresSessionStoreOptions,
} from "./postgres-store.js";
export { VirtualFS, normalizePath } from "./vfs.js";
export { createTools, type ToolDeps } from "./tools.js";
export {
	execCode,
	createHttpExecClient,
	getExecApiBase,
	DEFAULT_EXEC_API_BASE,
	type ExecClient,
	type ExecRequest,
	type ExecResponse,
} from "./exec-client.js";
