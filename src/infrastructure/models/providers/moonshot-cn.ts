import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { ProviderDefinition } from "../types.js";

export const MOONSHOT_CN_DOCS_URL = "https://platform.moonshot.cn/docs/intro";
export const MOONSHOT_CN_DEFAULT_MODEL = "kimi-k2-0905-preview";

export const moonshotCnDefinition: ProviderDefinition = {
	id: "moonshotai-cn",
	name: "Kimi (Moonshot)",
	envVar: "MOONSHOT_API_KEY",
	docsUrl: MOONSHOT_CN_DOCS_URL,
	defaultModelId: MOONSHOT_CN_DEFAULT_MODEL,
	register: (models: MutableModels) => models.setProvider(moonshotaiCnProvider()),
};