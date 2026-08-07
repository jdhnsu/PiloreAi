import { createModels, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { Agent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { PERSONAS } from "./personas.js";
import { createTools } from "./tools.js";
import { VirtualFS } from "./vfs.js";

const TUTOR_PROMPT = `你是 PiLore，一位编程教学导师。你掌握三种教学方法（Feynman、Socrates、Oris，见文末），根据学习者状态选择方法，并以该方法的风格亲自继续回答。

## 1. 判断该用哪种方法（心里有数，不说出方法的名字）
- 学习者说"太抽象/听不懂/打个比方/大白话"，需要类比和直觉 → Feynman 的路子
- 想深入理解单个知识点的原理、辨析易混淆概念 → Socrates 的路子
- 问题涉及多层知识嵌套、明显缺前置基础、"不知道从哪学起" → Oris 的路子
- 简单事实问答（如"Python 怎么读文件"）→ 不套用任何方法，直接简洁回答
- 判断不了就问一句：「你是想先有个直观感觉，还是想彻底搞懂原理？」
- 若消息带【指定教学方法：X】前缀（用户用 @X 明确指定）：直接采用该方法，跳过判断，回答时忽略前缀本身

## 2. 转交方式
- 用一句大白话说明安排，例如「这个得先补点基础，我按搭脚手架的方式来」；不提内部方法名字
- 然后自己以对应老师的风格和方法继续回答——绝不说"你去找 xx"
- 选定后按该方法的流程和输出格式推进；同一话题的连续追问保持该方法，不要重复声明
- 首次需要教学方法或切换方法时，先调用 adopt_persona 工具声明，再以该方法风格回答；简单事实问答、用户 @ 指定不要调用
- 交还时机：当前方法的教学阶段完成（讲解完毕且复述/检验通过、学习者表示懂了），或学习者明显切换到新话题、需要别的方法时，调用 adopt_persona("auto") 交还自动路由，下一轮重新判断；需要换成另一位老师时直接 adopt_persona(新方法)，不必先经过 auto`;

const EXECUTION_DISCIPLINE = `## 执行纪律（对所有教学方法生效）
- 代码写入虚拟工作区（write_file），在远程沙箱运行（run_code）；任何代码改动后必须实际运行，基于真实 stdout/stderr 讲解，不凭空猜输出
- 出错是学习机会：引导读懂报错、修改、再运行
- 不替学习者代写完整作业答案；用中文交流，简洁友好`;

// 设计文档按"本地文件 + 终端"编写，本 agent 只有 VFS + 远程沙箱，需统一翻译
const TOOL_ADAPTATION = `## 环境适配（教学方法中提到"文件/终端"时按此理解）
- 本环境没有本地磁盘和终端，只有虚拟工作区（内存文件系统）和远程沙箱
- 「读取相关代码」→ read_file；「写演示代码」→ write_file（写入新文件，不覆盖学习者已有文件）；「在终端运行演示」→ run_code
- 方法中"不要修改或删除用户的任何文件"指：不要覆盖或删除学习者工作区里已有的文件`;

/** 组装 PiLore system prompt：导师路由 + 执行纪律 + 环境适配 + 三位老师的方法论。 */
export function buildPiLorePrompt(): string {
	const sections = [TUTOR_PROMPT, EXECUTION_DISCIPLINE, TOOL_ADAPTATION];
	for (const p of PERSONAS) {
		sections.push(`# 教学方法：${p.name}（判断为 ${p.name} 路子时，按本节执行）\n\n${p.prompt}`);
	}
	return sections.join("\n\n---\n\n");
}

export const SYSTEM_PROMPT = buildPiLorePrompt();

/** 各 provider 的默认模型 ID（可用 npm run list-models 查看全部）。 */
export const DEFAULT_MODEL_IDS: Record<string, string> = {
	deepseek: "deepseek-v4-pro",
	"moonshotai-cn": "kimi-k2-0905-preview",
};

export function resolveProviderId(): string {
	return process.env.PROVIDER ?? "deepseek";
}

/** 注册本项目支持的 LLM provider；key 由各 provider 从环境变量解析。 */
export function createModelCollection(): MutableModels {
	const models = createModels();
	models.setProvider(deepseekProvider()); // DEEPSEEK_API_KEY
	models.setProvider(moonshotaiCnProvider()); // MOONSHOT_API_KEY
	return models;
}

export interface CreateAgentOptions {
	/** 注入自定义 models 集合（如 demo 用 fauxProvider）；默认注册真实 provider。 */
	models?: MutableModels;
	providerId?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	vfs?: VirtualFS;
}

export interface EduAgent {
	agent: Agent;
	vfs: VirtualFS;
	model: Model<string>;
	models: MutableModels;
}

export function createAgent(options: CreateAgentOptions = {}): EduAgent {
	const models = options.models ?? createModelCollection();
	const providerId = options.providerId ?? resolveProviderId();
	const modelId = options.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	const model = models.getModel(providerId, modelId);
	if (!model) {
		const available = models
			.getModels(providerId)
			.map((m) => m.id)
			.join(", ");
		throw new Error(
			`找不到模型 ${providerId}/${modelId}。该 provider 可用模型: ${available || "(无，请检查 API key)"}。可运行 npm run list-models 确认`,
		);
	}

	const vfs = options.vfs ?? new VirtualFS();
	const agent = new Agent({
		initialState: {
			systemPrompt: options.systemPrompt ?? SYSTEM_PROMPT,
			model,
			thinkingLevel: options.thinkingLevel ?? (process.env.THINKING_LEVEL as ThinkingLevel | undefined) ?? "off",
			tools: createTools(vfs),
		},
		streamFn: models.streamSimple.bind(models),
	});
	return { agent, vfs, model, models };
}
