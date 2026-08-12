import type { MutableModels } from "@earendil-works/pi-ai";

/** 模型 provider 的可插拔注册单元：pi-ai provider 工厂 + PiLore 侧元数据。 */
export interface ProviderDefinition {
	/** provider id（与 pi-ai provider 一致），是 PROVIDER 环境变量的取值之一 */
	id: string;
	/** 展示名称 */
	name: string;
	/** 该 provider 的 API key 环境变量名（用于提示与文档） */
	envVar: string;
	/** 平台文档 / 主页 URL */
	docsUrl?: string;
	/** 该 provider 的默认模型 id（未配置 MODEL_ID 时使用） */
	defaultModelId: string;
	/** 把该 provider 注册进 models 集合 */
	register: (models: MutableModels) => void;
}