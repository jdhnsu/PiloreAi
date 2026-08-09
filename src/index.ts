/** 组件公开入口：迁移到其它项目时只需依赖这里导出的 API。 */
export { createEduSession, type EduEvent, type EduSession, type EduSessionOptions } from "./session.js";
export { createAgent, buildBasePrompt, buildPersonaPrompt, buildPiLorePrompt, SYSTEM_PROMPT, type CreateAgentOptions, type EduAgent } from "./agent.js";
export * from "./models/index.js";
export { PERSONAS, PERSONA_KEYS, getPersona, resolveMention, buildCatalog, type Persona, type PersonaKey, type PersonaMeta, type PersonaCapabilities } from "./personas.js";
export { VirtualFS, normalizePath } from "./vfs.js";
export { createTools } from "./tools.js";
export { execCode, getExecApiBase, type ExecRequest, type ExecResponse } from "./exec-client.js";
