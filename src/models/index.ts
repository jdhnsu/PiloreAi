import { createModels, type MutableModels } from "@earendil-works/pi-ai";
import { PROVIDERS } from "./registry.js";
import type { ProviderDefinition } from "./types.js";

export type { ProviderDefinition } from "./types.js";
export { PROVIDERS } from "./registry.js";

export {
	LONGCAT_ID,
	LONGCAT_NAME,
	LONGCAT_DOCS_URL,
	LONGCAT_API_KEYS_URL,
	LONGCAT_BASE_URL,
	LONGCAT_API_KEY_ENV,
	LONGCAT_DEFAULT_MODEL,
	createLongCatProvider,
} from "./providers/longcat.js";
export { DEEPSEEK_DOCS_URL, DEEPSEEK_DEFAULT_MODEL } from "./providers/deepseek.js";
export { MOONSHOT_CN_DOCS_URL, MOONSHOT_CN_DEFAULT_MODEL } from "./providers/moonshot-cn.js";

/** 默认 provider（PROVIDER 未配置时，取注册表的第一个）。 */
export const DEFAULT_PROVIDER_ID = PROVIDERS[0].id;

/** 各 provider 的默认模型 ID（可用 npm run list-models 查看全部）。 */
export const DEFAULT_MODEL_IDS: Record<string, string> = Object.fromEntries(
	PROVIDERS.map((p) => [p.id, p.defaultModelId]),
);

export function resolveProviderId(): string {
	return process.env.PROVIDER ?? DEFAULT_PROVIDER_ID;
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
	return PROVIDERS.find((p) => p.id === id);
}

/**
 * 注册本项目支持的 LLM provider；API key 由各 provider 从对应环境变量解析
 * （DEEPSEEK_API_KEY / MOONSHOT_API_KEY / LONGCAT_API_KEY）。
 */
export function createModelCollection(): MutableModels {
	const models = createModels();
	for (const p of PROVIDERS) p.register(models);
	return models;
}