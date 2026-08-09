import type { Persona, PersonaKey } from "./personas.js";

/**
 * 教学状态单一源(shared state by session 与工具共同持有):
 * - activePersona:当前激活的教学方法(undefined = PiLore 自动路由)
 * - teachingByPersona:按老师 key 保存的教学阶段工作记忆(切老师不丢,切回可续)
 * - switchCount / 护栏:同一轮内 adopt_persona 的非 auto 切换次数上限
 *
 * 设计要点:这是 persona 相关的唯一事实源。工具(adopt_persona / update_teaching)、
 * agent 钩子(prepareNextTurn / beforeToolCall)、session 层都读它,不再各自维护副本。
 */
export interface TeachingProgress {
	/** 当前教学阶段(由各 persona 的自定义流程决定,如 Oris 的「拆解 / 诊断 / 分层讲解 / 演示 / 收口」) */
	stage: string;
	/** 当前主题,一句话 */
	topic: string;
	/** 已覆盖 / 已带过的知识点 */
	covered: string[];
	/** 待展开 / 后续可回主线深挖的点 */
	pending: string[];
}

/** persona 切换来源:model = adopt_persona 工具;user = @指定 或 /api/persona */
export type PersonaSource = "model" | "user";

/** 同一轮内非 auto 的 adopt_persona 切换次数上限(超限工具抛错让模型自纠;auto 交还不计) */
export const MAX_SWITCHES_PER_TURN = 2;

export class SharedState {
	activePersona: Persona | undefined = undefined;

	/** 按 persona key 保存的教学进度:切换老师不丢,切回可以续讲(初始为空) */
	readonly teachingByPersona = new Map<PersonaKey, TeachingProgress>();

	/** 同轮内非 auto 的 adopt 计数(prepareTurn / auto 交还时清零) */
	switchCount = 0;

	private listeners = new Set<(persona: Persona | undefined, source: PersonaSource) => void>();

	/** 设置 / 清除当前老师。唯一写入口,所有路径(工具、@指定、/api/persona)都经由它 */
	setPersona(persona: Persona | undefined, source: PersonaSource): void {
		this.activePersona = persona;
		for (const cb of this.listeners) cb(persona, source);
	}

	/** 订阅 persona 变化(会话层用它发 EduEvent,无需再解析工具结果) */
	onPersonaChange(cb: (persona: Persona | undefined, source: PersonaSource) => void): void {
		this.listeners.add(cb);
	}

	/** 读取某位老师(默认当前激活老师)的教学进度快照 */
	getTeaching(key?: PersonaKey): TeachingProgress | undefined {
		return this.teachingByPersona.get(key ?? this.activePersona?.key ?? "");
	}

	/** 合并写入当前老师的教学进度;无激活老师时抛错(update_teaching 工具直接转 isError 结果) */
	updateTeaching(partial: Partial<TeachingProgress>, key?: PersonaKey): TeachingProgress {
		const target = key ?? this.activePersona?.key;
		if (!target) throw new Error("当前未激活任何教学方法,请先 adopt_persona 声明,再记录教学进度");
		const current: TeachingProgress = this.teachingByPersona.get(target) ?? {
			stage: "",
			topic: "",
			covered: [],
			pending: [],
		};
		const next: TeachingProgress = {
			stage: partial.stage ?? current.stage,
			topic: partial.topic ?? current.topic,
			covered: partial.covered ?? current.covered,
			pending: partial.pending ?? current.pending,
		};
		this.teachingByPersona.set(target, next);
		return next;
	}

	/**
	 * 护栏:校验一次非 auto 的 adopt_persona 是否允许。
	 * 返回拦截原因(undefined = 放行)。规则:
	 * - 已以相同方法教学 → 拦截(避免重复声明;工具描述本来就要求不要重复调用)
	 * - 当前轮非 auto 切换次数 >= MAX_SWITCHES_PER_TURN → 拦截(防抖动)
	 */
	canAdopt(key: PersonaKey): string | undefined {
		if (this.activePersona?.key === key) return `已经以 ${this.activePersona.name}(@${key}) 教学,同一个方法不要重复声明`;
		if (this.switchCount >= MAX_SWITCHES_PER_TURN)
			return `本轮已切换教学方法 ${this.switchCount} 次(上限 ${MAX_SWITCHES_PER_TURN}),请先用当前方法把当前问题讲完,下一轮再切换`;
		return undefined;
	}

	/** 记录一次成功的非 auto 切换(adopt_persona 工具唯一有权调用) */
	recordSwitch(): void {
		this.switchCount += 1;
	}

	/**
	 * 每次用户查询开始前调用(会话层 prompt / CLI 发问时):重置切换预算。
	 * 注意:预算跨 LLM 轮次(一次用户查询内可能有多次 LLM 调用/多个工具回合),
	 * 不能放在 prepareNextTurn 里,否则护栏在工具回合之间被清零、失去约束力。
	 */
	resetUserTurn(): void {
		this.switchCount = 0;
	}
}