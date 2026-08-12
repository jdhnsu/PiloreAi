/**
 * 组件边界接口与统一配置：嵌入其它项目时，只需要构造一份 EduAgentConfig 即可替换
 * 模型集合、老师集合、执行后端与工作区。所有依赖均有缺省值，`createEduSession({})`
 * 即可按内置默认跑起来。
 *
 * import 本模块不产生任何副作用（不扫磁盘、不读 env、不发请求）；
 * 缺省值在 createAgent/createEduSession 内部按需解析。
 */
import type { MutableModels } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExecClient } from "./exec-client.js";
import type { Persona } from "./personas.js";
import type { VirtualFS } from "./vfs.js";
import type { LlmTelemetrySink } from "./telemetry.js";
import type { CustomModelConfig } from "./models/custom.js";

/** @deprecated Education + Code compatibility configuration. New integrations use Core RuntimeConfig/SessionConfig. */
export interface EduAgentConfig {
	/** 自定义 provider HTTP fetch（代理、测试或请求级观测）；默认使用 globalThis.fetch。 */
	fetch?: typeof globalThis.fetch;
	/** 脱敏的逻辑模型调用与真实 HTTP attempt 事件；默认关闭。 */
	llmTelemetry?: LlmTelemetrySink;
	/** 注入自定义 models 集合（如 demo 用 fauxProvider）；默认注册内置 provider。 */
	models?: MutableModels;
	/** 单模型自定义连接（URL、协议、模型 ID）；优先于 providerId/modelId，并注册到 models 集合。 */
	customModel?: CustomModelConfig;
	/** provider id；默认读 PROVIDER 环境变量，缺省取注册表第一项。 */
	providerId?: string;
	/** 模型 id；默认读 MODEL_ID 环境变量，缺省取该 provider 的默认模型。 */
	modelId?: string;
	/** 推理级别；默认读 THINKING_LEVEL 环境变量，缺省 "off"。 */
	thinkingLevel?: ThinkingLevel;
	/** 自定义基座 system prompt（自动路由模式的完整提示词）。 */
	systemPrompt?: string;
	/** 自定义虚拟工作区；默认新建独立实例。 */
	vfs?: VirtualFS;
	/** 自定义老师集合（含路由目录与能力契约）；默认懒加载内置 agent-design/ 目录。 */
	personas?: Persona[];
	/** 自定义执行后端；默认为 codapi 风格 HTTP 客户端（读 EXEC_API_BASE）。 */
	exec?: ExecClient;
	/**
	 * 单次 prompt 运行的 LLM 回合数上限（0/undefined = 不限制）。
	 * 用于测试护栏：模型陷入纯工具循环时强制结束本轮，避免烧 token。
	 * 每轮 `agent_start` 自动清零。
	 */
	maxTurns?: number;
}
