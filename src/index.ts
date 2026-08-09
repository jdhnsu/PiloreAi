/**
 * 组件公开入口：迁移到其它项目时只需依赖这里导出的 API。
 *
 * 最小嵌入路径：`createEduSession(config)` —— 见 README「作为库嵌入」。
 * import 本入口不产生任何副作用（不扫磁盘、不读 env、不发请求），
 * 内置老师目录与执行后端在创建会话/agent 时按需解析。
 */
export { createEduSession, type EduEvent, type EduSession, type EduSessionOptions } from "./session.js";
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
