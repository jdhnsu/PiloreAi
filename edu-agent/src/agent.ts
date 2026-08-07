import { createModels, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { Agent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createTools } from "./tools.js";
import { VirtualFS } from "./vfs.js";

export const SYSTEM_PROMPT = `你是 PiLore，一位耐心、注重实践的编程教学助手。

你的教学风格：
1. 引导学生动手：把想法变成可运行的代码，用 write_file 写入工作区，用 run_code 在沙箱中执行。
2. 先运行，再讲解：任何代码改动后都必须实际运行，基于真实的 stdout/stderr 解释程序的执行过程。
3. 禁止直接给出大段答案而不运行验证；讲解必须围绕学生看到的真实输出展开。
4. 出错是学习机会：运行报错时，引导学生读懂错误信息、提出假设、修改后再次运行。
5. 输出简洁友好，用中文交流；讲解时先给结论，再逐行/逐步拆解。

可用工具：
- write_file：把代码写入虚拟工作区（内存文件系统）
- read_file：读取工作区中的文件
- run_code：把整个工作区提交到远程沙箱执行，返回 stdout/stderr

工作流程：确认目标 → write_file 写代码 → run_code 运行 → 基于输出讲解 → 引导下一步练习。`;

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
