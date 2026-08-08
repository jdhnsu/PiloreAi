import type { ProviderDefinition } from "./types.js";
import { deepseekDefinition } from "./providers/deepseek.js";
import { moonshotCnDefinition } from "./providers/moonshot-cn.js";
import { longcatDefinition } from "./providers/longcat.js";

/**
 * 已注册 provider 的注册表（顺序即默认优先级，第一项为默认 provider）。
 * 新增 provider：在 providers/ 下实现一个 ProviderDefinition，然后在此追加一项。
 * 各 provider 的文档 URL 见对应定义的 docsUrl 字段（如 LongCat: https://longcat.chat/platform/docs/zh/）。
 */
export const PROVIDERS: readonly ProviderDefinition[] = [
	deepseekDefinition,
	moonshotCnDefinition,
	longcatDefinition,
];