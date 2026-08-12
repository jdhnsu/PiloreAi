import { createProvider, envApiKeyAuth, type Model, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ProviderDefinition } from "../types.js";

/**
 * LongCat API 开放平台，完全兼容 OpenAI API 规范。
 * 文档: https://longcat.chat/platform/docs/zh/
 * API Key 在: https://longcat.chat/platform/api_keys 创建
 */
export const LONGCAT_ID = "longcat";
export const LONGCAT_NAME = "LongCat";
export const LONGCAT_DOCS_URL = "https://longcat.chat/platform/docs/zh/";
export const LONGCAT_API_KEYS_URL = "https://longcat.chat/platform/api_keys";
export const LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
export const LONGCAT_API_KEY_ENV = "LONGCAT_API_KEY";
export const LONGCAT_DEFAULT_MODEL = "LongCat-2.0";

/** LongCat-2.0：1M 上下文、最大 128K 输出；价格为长猫官方原价（元/百万 tokens）。 */
const LONGCAT_MODELS: Model<"openai-completions">[] = [
	{
		id: LONGCAT_DEFAULT_MODEL,
		name: "LongCat-2.0",
		api: "openai-completions",
		provider: LONGCAT_ID,
		baseUrl: LONGCAT_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 5, output: 20, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
		},
	},
];

/** 注册 OpenAI 兼容格式的 LongCat provider（OpenAI 接入端点见 {@link LONGCAT_BASE_URL}）。 */
export function createLongCatProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: LONGCAT_ID,
		name: LONGCAT_NAME,
		baseUrl: LONGCAT_BASE_URL,
		auth: {
			apiKey: envApiKeyAuth("LongCat API key（创建于 https://longcat.chat/platform/api_keys）", [LONGCAT_API_KEY_ENV]),
		},
		models: LONGCAT_MODELS,
		api: openAICompletionsApi(),
	});
}

export const longcatDefinition: ProviderDefinition = {
	id: LONGCAT_ID,
	name: LONGCAT_NAME,
	envVar: LONGCAT_API_KEY_ENV,
	docsUrl: LONGCAT_DOCS_URL,
	defaultModelId: LONGCAT_DEFAULT_MODEL,
	register: (models: MutableModels) => models.setProvider(createLongCatProvider()),
};