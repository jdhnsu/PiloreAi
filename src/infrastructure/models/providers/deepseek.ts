import { deepseekProvider } from "@pilore/pi-ai/providers/deepseek";
import type { MutableModels } from "@pilore/pi-ai";
import type { ProviderDefinition } from "../types.js";

export const DEEPSEEK_DOCS_URL = "https://platform.deepseek.com/";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-pro";

export const deepseekDefinition: ProviderDefinition = {
	id: "deepseek",
	name: "DeepSeek",
	envVar: "DEEPSEEK_API_KEY",
	docsUrl: DEEPSEEK_DOCS_URL,
	defaultModelId: DEEPSEEK_DEFAULT_MODEL,
	register: (models: MutableModels) => models.setProvider(deepseekProvider()),
};