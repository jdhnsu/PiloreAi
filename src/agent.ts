import { type Model, type MutableModels } from "@earendil-works/pi-ai";
import { Agent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { buildCatalog, type Persona } from "./personas.js";
import { createTools, type PersonaState } from "./tools.js";
import { VirtualFS } from "./vfs.js";
import { createModelCollection, DEFAULT_MODEL_IDS, resolveProviderId } from "./models/index.js";

export { createModelCollection, DEFAULT_MODEL_IDS, resolveProviderId } from "./models/index.js";

const ROLE = `你是 PiLore，一位编程教学导师，掌握多种教学方法（见「教学方法目录」）。根据学习者状态选择方法，并以该方法的风格亲自继续回答。`;

/** 自动路由模式（无 active persona）：判断 → adopt_persona → auto 交还。目录由 frontmatter 生成，是判断方法的唯一依据。 */
const ROUTER_GUIDE = `## 1. 判断该用哪种方法（心里有数，不说出方法的名字）
- 学习者说"太抽象/听不懂/打个比方/大白话"，需要类比和直觉 → Feynman 的路子
- 想深入理解单个知识点的原理、辨析易混淆概念 → Socrates 的路子
- 问题涉及多层知识嵌套、明显缺前置基础、"不知道从哪学起" → Oris 的路子
- 简单事实问答（如"Python 怎么读文件"）→ 不套用任何方法，直接简洁回答
- 判断不了就问一句：「你是想先有个直观感觉，还是想彻底搞懂原理？」

## 2. 转交方式
- 用一句大白话说明安排，例如「这个得先补点基础，我按搭脚手架的方式来」；不提内部方法名字
- 然后自己以对应老师的风格和方法继续回答——绝不说"你去找 xx"
- 首次需要教学方法或切换方法时，先调用 adopt_persona 工具声明，再以该方法风格回答；简单事实问答不要调用
- 交还时机：当前方法的教学阶段完成（讲解完毕且复述/检验通过、学习者表示懂了），或学习者明显切换到新话题、需要别的方法时，调用 adopt_persona("auto") 交还自动路由，下一轮重新判断；需要换成另一位老师时直接 adopt_persona(新方法)，不必先经过 auto`;

/** Persona 激活模式：不再路由判断，只保留交接规则。 */
const PERSONA_MODE_GUIDE = `## 当前教学模式
- 你正在以 {name} 的教学方法回答，严格执行下文该方法的流程与输出格式，不要重新判断或换方法
- 交还时机：当前方法的教学阶段完成（讲解完毕且检验通过、学习者表示懂了），或学习者明显切换到新话题、需要别的方法时，调用 adopt_persona("auto") 交还自动路由，下一轮重新判断
- 需要换成另一位老师时直接 adopt_persona(新方法)，不必先经过 auto`;

const EXECUTION_DISCIPLINE = `## 执行纪律（对所有教学方法生效）
- 代码写入虚拟工作区（write_file），在远程沙箱运行（run_code）；任何代码改动后必须实际运行，基于真实 stdout/stderr 讲解，不凭空猜输出
- 出错是学习机会：引导读懂报错、修改、再运行
- 不替学习者代写完整作业答案；用中文交流，简洁友好`;

// 设计文档按"本地文件 + 终端"编写，本 agent 只有 VFS + 远程沙箱，需统一翻译
const TOOL_ADAPTATION = `## 环境适配（教学方法中提到"文件/终端"时按此理解）
- 本环境没有本地磁盘和终端，只有虚拟工作区（内存文件系统）和远程沙箱
- 「读取相关代码」→ read_file；「写演示代码」→ write_file（写入新文件，不覆盖学习者已有文件）；「在终端运行演示」→ run_code
- 方法中"不要修改或删除用户的任何文件"指：不要覆盖或删除学习者工作区里已有的文件`;

/** 组装自动路由 system prompt：角色 + 路由规则 + 目录 + 执行纪律 + 环境适配。不含任何方法论全文。 */
export function buildBasePrompt(): string {
	const sections = [ROLE, ROUTER_GUIDE, `## 教学方法目录\n\n${buildCatalog()}`, EXECUTION_DISCIPLINE, TOOL_ADAPTATION];
	return sections.join("\n\n---\n\n");
}

/** 组装 persona 激活时的 system prompt：当前教学模式 + 执行纪律 + 环境适配 + 该老师方法论全文。 */
export function buildPersonaPrompt(persona: Persona): string {
	const sections = [
		`你是 PiLore，当前以 ${persona.name}（@${persona.key}）的教学方法进行教学。`,
		PERSONA_MODE_GUIDE.replace("{name}", persona.name),
		EXECUTION_DISCIPLINE,
		TOOL_ADAPTATION,
		`# 教学方法：${persona.name}\n\n${persona.prompt}`,
	];
	return sections.join("\n\n---\n\n");
}

/** @deprecated 改名 buildBasePrompt() */
export function buildPiLorePrompt(): string {
	return buildBasePrompt();
}

export const SYSTEM_PROMPT = buildBasePrompt();

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
	/** 当前激活的教学方法（undefined = 自动路由）；会话层用它驱动 systemPrompt 换入 */
	getActivePersona(): Persona | undefined;
	setActivePersona(persona: Persona | undefined): void;
}

/** 能力 → 工具映射（运行时无关的能力词汇在此绑定到具体工具；file.modify 在钩子内特判） */
const CAPABILITY_BY_TOOL: Record<string, string> = {
	write_file: "file.write",
	read_file: "file.read",
	run_code: "exec.run",
};

const CAPABILITY_LABEL: Record<string, string> = {
	"file.write": "写入文件",
	"file.modify": "覆盖已有文件",
	"file.read": "读取文件",
	"exec.run": "运行代码",
};

/** 当前 persona 的 capabilities 是否拒绝该工具调用；返回拦截原因。 */
function checkCapability(persona: Persona, toolName: string, args: unknown, vfs: VirtualFS): string | undefined {
	const caps = persona.meta.capabilities;
	// write_file 细分为两种能力：目标已存在 → file.modify；新文件 → file.write
	if (toolName === "write_file") {
		const path = (args as { path?: unknown }).path;
		if (typeof path === "string" && vfs.has(path)) {
			if (caps["file.modify"] === "deny") return "file.modify";
		}
	}
	const cap = CAPABILITY_BY_TOOL[toolName];
	if (cap && caps[cap] === "deny") return cap;
	return undefined;
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
	const basePrompt = options.systemPrompt ?? SYSTEM_PROMPT;
	const personaState: PersonaState = { activePersona: undefined };
	let agent: Agent;
	agent = new Agent({
		initialState: {
			systemPrompt: basePrompt,
			model,
			thinkingLevel: options.thinkingLevel ?? (process.env.THINKING_LEVEL as ThinkingLevel | undefined) ?? "off",
			tools: createTools(vfs, personaState),
		},
		streamFn: models.streamSimple.bind(models),
		// persona 激活/交还后，把 systemPrompt 换入/换回（工具已写入 personaState）
		prepareNextTurn: async () => {
			const expected = personaState.activePersona ? buildPersonaPrompt(personaState.activePersona) : basePrompt;
			if (agent.state.systemPrompt !== expected) {
				agent.state.systemPrompt = expected;
				return {
					context: {
						systemPrompt: expected,
						messages: agent.state.messages.slice(),
						tools: agent.state.tools.slice(),
					},
				};
			}
			return undefined;
		},
		// 权限执行：active persona 的 capabilities deny 命中 → 拦截工具（含用户 @ 指定，选择即接受契约）
		beforeToolCall: async (ctx) => {
			const persona = personaState.activePersona;
			if (!persona) return undefined; // auto 模式：全局默认全允许
			const denied = checkCapability(persona, ctx.toolCall.name, ctx.args, vfs);
			if (!denied) return undefined;
			return {
				block: true,
				reason: `当前教学方法（${persona.name}）不允许${CAPABILITY_LABEL[denied] ?? denied}（${denied}: deny）`,
			};
		},
	});
	return {
		agent,
		vfs,
		model,
		models,
		getActivePersona: () => personaState.activePersona,
		setActivePersona: (persona) => {
			personaState.activePersona = persona;
		},
	};
}
