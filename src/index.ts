/** PiLore public API. All consumers import from this module. */
export { createRuntime, type Runtime } from "./core/runtime/index.js";
export { createSession, type Session, type SessionConfig } from "./core/session/index.js";
export { CoreState } from "./core/state/index.js";
export {
	ContextPolicyError,
	compactContext,
	createContextSummary,
	estimateContextTokens,
	estimateTextTokens,
	inspectContext,
	isContextSummary,
	pruneContextForRequest,
	resolveContextPolicy,
	type ContextCompactionResult,
	type ContextPolicy,
	type ContextStatus,
	type ContextSummaryMessage,
	type ResolvedContextPolicy,
} from "./core/context-policy/index.js";
export { CORE_SESSION_SNAPSHOT_VERSION, validateCoreSnapshot, validateSnapshotMessages, cloneCoreSnapshot } from "./core/snapshot/index.js";
export type {
	JsonValue,
	Profile,
	ProfileDefinition,
	DomainPack,
	ToolGroup,
	ToolManifest,
	RouterConfig,
	SnapshotExtension,
	RuntimeConfig,
	SessionEvent,
	SessionSnapshot,
	SessionSnapshotV1,
} from "./core/types.js";
export {
	appendProfileContext,
	convertProfileMessages,
	createProfileContext,
	createRouterTool,
	createUpdateProfileStateTool,
	hashProfile,
	isProfileContext,
	type ProfileContextMessage,
} from "./core/router/index.js";
export {
	INTERNAL_TOOL_NAMES,
	compileToolRegistry,
	createActivateToolsetTool,
	toolsForState,
	validateProfileCapabilities,
	validateToolManifest,
} from "./core/tool-runtime/index.js";

export * from "./packs/code/index.js";
export * from "./packs/english/index.js";
export * from "./packs/shared/academic/index.js";
export * from "./packs/math/index.js";
export * from "./packs/physics/index.js";
export * from "./packs/history/index.js";
export * from "./infrastructure/models/index.js";
export {
	createObservedStreamFn,
	type LlmTelemetryEvent,
	type LlmTelemetrySink,
	type ObservedStreamOptions,
} from "./infrastructure/telemetry/index.js";
export {
	createAes256GcmCryptoProvider,
	CryptoProviderError,
	type CryptoProvider,
	type CryptoContext,
	type EncryptedPayload,
	type Aes256GcmCryptoOptions,
} from "./infrastructure/persistence/crypto.js";
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
	type StoredSnapshot,
	type RunAuditPayload,
	type RunMetrics,
	type CreateStoredSession,
	type BeginRunInput,
	type CompleteRunInput,
	type FailRunInput,
} from "./infrastructure/persistence/persistence.js";
export { InMemorySessionStore, createInMemorySessionStore } from "./infrastructure/persistence/memory-store.js";
export {
	POSTGRES_MIGRATION_001,
	applyPostgresMigrations,
	PostgresSessionStore,
	createPostgresSessionStore,
	type PostgresSessionStoreOptions,
} from "./infrastructure/persistence/postgres-store.js";
