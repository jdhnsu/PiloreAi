import {
	createProvider,
	type ApiKeyAuth,
	type Model,
	type MutableModels,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export const CUSTOM_MODEL_PROVIDER_ID = "custom";

export const CUSTOM_MODEL_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

export type CustomModelProtocol = (typeof CUSTOM_MODEL_PROTOCOLS)[number];

/** 单一自定义模型的连接配置；密钥只保留在运行时配置或环境变量中。 */
export interface CustomModelConfig {
	/** 服务基址，例如 `https://api.example.com/v1`。 */
	url: string;
	/** 服务所实现的流式 API 协议。 */
	protocol: CustomModelProtocol;
	/** 服务端接受的模型 ID。 */
	id: string;
	/** provider 标识；缺省为 `custom`。 */
	providerId?: string;
	/** 可选展示名称；缺省使用模型 ID。 */
	name?: string;
	/** API key；未提供时按无鉴权本地服务处理。 */
	apiKey?: string;
}

const API_BY_PROTOCOL: Record<CustomModelProtocol, ProviderStreams> = {
	"openai-completions": openAICompletionsApi(),
	"openai-responses": openAIResponsesApi(),
	"anthropic-messages": anthropicMessagesApi(),
};

function requiredText(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`自定义模型的 ${field} 不能为空`);
	return normalized;
}

function normalizeBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(requiredText(value, "url"));
	} catch {
		throw new Error("自定义模型的 url 必须是有效的 http 或 https 地址");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("自定义模型的 url 只支持 http 或 https");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("自定义模型的 url 不能包含账号、查询参数或片段");
	}
	return url.toString().replace(/\/$/, "");
}

function customApiKeyAuth(apiKey: string | undefined): ApiKeyAuth {
	return {
		name: "自定义模型 API key",
		resolve: async ({ signal }) => {
			signal.throwIfAborted();
			return {
				auth: { apiKey: apiKey || "not-required" },
				source: apiKey ? "custom config" : "no API key",
			};
		},
	};
}

/** 创建一个只含指定模型的 provider，适用于 OpenAI 兼容、Responses 与 Anthropic Messages 服务。 */
export function createCustomModelProvider(config: CustomModelConfig): Provider<CustomModelProtocol> {
	const protocol = config.protocol;
	if (!CUSTOM_MODEL_PROTOCOLS.includes(protocol)) {
		throw new Error(`不支持的自定义模型协议: ${String(protocol)}`);
	}
	const providerId = requiredText(config.providerId ?? CUSTOM_MODEL_PROVIDER_ID, "providerId");
	const id = requiredText(config.id, "id");
	const baseUrl = normalizeBaseUrl(config.url);
	const model: Model<CustomModelProtocol> = {
		id,
		name: config.name?.trim() || id,
		api: protocol,
		provider: providerId,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
	};
	return createProvider({
		id: providerId,
		name: config.name?.trim() || providerId,
		baseUrl,
		auth: { apiKey: customApiKeyAuth(config.apiKey?.trim()) },
		models: [model],
		api: API_BY_PROTOCOL[protocol],
	});
}

/** 将自定义模型注册到给定集合；拒绝覆盖已有 provider，避免误改内置模型。 */
export function registerCustomModel(models: MutableModels, config: CustomModelConfig): string {
	const provider = createCustomModelProvider(config);
	if (models.getProvider(provider.id)) {
		throw new Error(`自定义模型 providerId 已存在: ${provider.id}`);
	}
	models.setProvider(provider);
	return provider.id;
}

/** 从环境变量按需解析自定义模型配置；未配置时返回 undefined。 */
export function resolveCustomModelConfig(): CustomModelConfig | undefined {
	const url = process.env.CUSTOM_MODEL_URL;
	const protocol = process.env.CUSTOM_MODEL_PROTOCOL as CustomModelProtocol | undefined;
	const id = process.env.CUSTOM_MODEL_ID;
	if (!url && !protocol && !id) return undefined;
	if (!url || !protocol || !id) {
		throw new Error("自定义模型需同时配置 CUSTOM_MODEL_URL、CUSTOM_MODEL_PROTOCOL 和 CUSTOM_MODEL_ID");
	}
	return {
		url,
		protocol,
		id,
		providerId: process.env.CUSTOM_MODEL_PROVIDER_ID,
		apiKey: process.env.CUSTOM_MODEL_API_KEY,
	};
}