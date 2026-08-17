import {
	createProvider,
	type ApiKeyAuth,
	type Model,
	type MutableModels,
	type Provider,
} from "@pilore/pi-ai";
import { openAICompletionsApi } from "@pilore/pi-ai/api/openai-completions.lazy";
import type { ProviderDefinition } from "../types.js";

/**
 * Ollama — 本地运行的 LLM 服务，兼具 OpenAI 兼容端点与自有原生 REST API。
 * 官方文档：https://docs.ollama.com/capabilities/
 *
 * 架构选择（见 README / AGENTS.md「嵌入契约」）：
 *  - 聊天补全走 Pi-ai 的 `openai-completions` api（Ollama 的 `/v1/chat/completions`
 *    与之兼容），从而纳入统一的 `Models` 集合、复用流式/工具调用/重试/成本计算，
 *    与 deepseek / longcat 完全一致。
 *  - 嵌入、本地模型列表、模型元数据等**非聊天**能力，Ollama 原生 REST API
 *    （`/api/embed`、`/api/tags`、`/api/show`）覆盖更全，故在 Pi-ai 之上额外封装
 *    {@link OllamaClient}，供需要这些能力的消费者按需使用。
 */

/** Ollama 服务基址；缺省指向本地默认端口。 */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
/** 本 provider 在 PROVIDER 环境变量中的取值。 */
export const OLLAMA_ID = "ollama";
export const OLLAMA_NAME = "Ollama";
/** 本地服务通常无需 API key；保留 envVar 仅为文档/约定一致。 */
export const OLLAMA_API_KEY_ENV = "OLLAMA_API_KEY";
export const OLLAMA_DOCS_URL = "https://docs.ollama.com/capabilities/";
/** 未显式指定 MODEL_ID 时使用的默认模型（需用户已 `ollama pull`）。 */
export const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.2";

/**
 * Ollama 聊天补全模型（OpenAI 兼容）。
 * 本地推理无真实计费，cost 置 0；上下文/输出上限取 Ollama 常见保守值，
 * 可按实际部署模型覆盖。
 */
const OLLAMA_CHAT_MODEL: Model<"openai-completions"> = {
	id: OLLAMA_DEFAULT_MODEL,
	name: OLLAMA_DEFAULT_MODEL,
	api: "openai-completions",
	provider: OLLAMA_ID,
	baseUrl: `${OLLAMA_BASE_URL}/v1`,
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 32_000,
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		maxTokensField: "max_tokens",
		supportsStrictMode: false,
	},
};

/** Ollama 无 key 时发给 OpenAI 兼容端点的占位 key（本地服务会忽略它）。 */
const OLLAMA_PLACEHOLDER_KEY = "ollama";

/**
 * 免 key 的 ambient auth：`resolve()` 恒返回已配置（有存储凭据/env key 用真实值，
 * 否则用占位 key），避免 pi-ai 因「未解析出 key」抛 `Provider is not configured`。
 */
const ollamaApiKeyAuth: ApiKeyAuth = {
	name: "Ollama API key（本地服务通常无需配置）",
	resolve: async ({ ctx, credential, signal }) => {
		signal.throwIfAborted();
		if (credential?.key) {
			return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
		}
		const envValue = await ctx.env(OLLAMA_API_KEY_ENV);
		signal.throwIfAborted();
		if (envValue) return { auth: { apiKey: envValue }, source: OLLAMA_API_KEY_ENV };
		return { auth: { apiKey: OLLAMA_PLACEHOLDER_KEY }, source: "ambient" };
	},
};

/** 注册基于 Pi-ai 的 Ollama 聊天补全 provider（OpenAI 兼容端点）。 */
export function createOllamaProvider(baseUrl: string = OLLAMA_BASE_URL): Provider<"openai-completions"> {
	return createProvider({
		id: OLLAMA_ID,
		name: OLLAMA_NAME,
		baseUrl: `${baseUrl}/v1`,
		auth: { apiKey: ollamaApiKeyAuth },
		models: [OLLAMA_CHAT_MODEL],
		api: openAICompletionsApi(),
	});
}

/* ───────────────────────── Ollama 原生 REST 客户端 ─────────────────────────
 * 覆盖聊天之外的能力：嵌入生成、模型列表、模型元数据。
 * 这些端点不走 OpenAI 兼容层（虽 Ollama 也提供 /v1/embeddings，原生 /api/embed
 * 更贴近官方文档且字段稳定），独立封装以便直接调用。
 */

/** `/api/tags` 返回的单个模型条目。 */
export interface OllamaModelTag {
	name: string;
	model?: string;
	modified_at?: string;
	size?: number;
	digest?: string;
	details?: Record<string, unknown>;
}

/** `/api/embed` 请求体。 */
export interface OllamaEmbedRequest {
	model: string;
	input: string | string[];
	truncate?: boolean;
	options?: Record<string, unknown>;
	keep_alive?: string;
}

/** `/api/embed` 响应体。 */
export interface OllamaEmbedResponse {
	model: string;
	embeddings: number[][];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
}

/**
 * Ollama 原生 REST 客户端：嵌入、模型列表、模型信息查询。
 * 与 Pi-ai 聊天补全解耦——聊天走 Models 集合，此处提供其余官方能力。
 */
export class OllamaClient {
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof globalThis.fetch;
	private readonly headers: Record<string, string>;

	constructor(opts?: { baseUrl?: string; fetch?: typeof globalThis.fetch; apiKey?: string }) {
		this.baseUrl = (opts?.baseUrl ?? OLLAMA_BASE_URL).replace(/\/$/, "");
		this.fetchImpl = opts?.fetch ?? globalThis.fetch;
		this.headers = { "Content-Type": "application/json", ...(opts?.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}) };
	}

	/** 列出本地已拉取的模型（`/api/tags`）。 */
	async listModels(signal?: AbortSignal): Promise<OllamaModelTag[]> {
		const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
			method: "GET",
			headers: this.headers,
			signal,
		});
		if (!res.ok) throw new Error(`Ollama listModels failed: ${res.status} ${await res.text()}`);
		const json = (await res.json()) as { models?: OllamaModelTag[] };
		return json.models ?? [];
	}

	/** 生成文本嵌入（`/api/embed`）。支持单条或多条输入。 */
	async embed(req: OllamaEmbedRequest, signal?: AbortSignal): Promise<OllamaEmbedResponse> {
		const res = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(req),
			signal,
		});
		if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
		return (await res.json()) as OllamaEmbedResponse;
	}

	/** 查询模型元数据（`/api/show`，含 family / parameter_size / capabilities 等）。 */
	async showModel(model: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		const res = await this.fetchImpl(`${this.baseUrl}/api/show`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({ model }),
			signal,
		});
		if (!res.ok) throw new Error(`Ollama showModel failed: ${res.status} ${await res.text()}`);
		return (await res.json()) as Record<string, unknown>;
	}
}

export const ollamaDefinition: ProviderDefinition = {
	id: OLLAMA_ID,
	name: OLLAMA_NAME,
	envVar: OLLAMA_API_KEY_ENV,
	docsUrl: OLLAMA_DOCS_URL,
	defaultModelId: OLLAMA_DEFAULT_MODEL,
	register: (models: MutableModels) => models.setProvider(createOllamaProvider()),
};
