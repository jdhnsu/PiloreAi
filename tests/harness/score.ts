// 评分模型:TEST-SPEC 双套评分(离线确定性 / 在线行为达成度)的纯计算层。
// 见 tests/TEST-SPEC.md §5 评分模型。
import type { Dimension } from "./session-driver.js";

export type { Dimension } from "./session-driver.js";

/** 离线用例定义:内部用 ctx.check() 记录子断言,全部以 0/1 计。 */
export interface OfflineCaseDef {
	id: string;
	name: string;
	dimension: Dimension;
	weight: number;
	run: (ctx: OfflineCaseContext) => Promise<void>;
}

export interface OfflineCaseContext {
	/** 断言记录:子断言名 + 是否通过(+ 细节) */
	check(name: string, pass: boolean, detail?: string): void;
	/** 读取已记录断言数(供运行器计算通过率) */
	getChecks(): { name: string; pass: boolean; detail?: string }[];
}

/** 已运行用例的结果(统一汇总) */
export interface CaseRunResult {
	id: string;
	name: string;
	dimension: Dimension;
	weight: number;
	/** 得分 0~1(离线=通过子断言率;在线=规则权重达成度) */
	score: number;
	/** 离线:与离线通过率;在线:逐轮得分数组 */
	detail: unknown;
	/** 是否因缺 key/环境跳过 */
	skipped?: boolean;
}

/** 聚合:总分(0~100)、分维度得分表、等级。 */
export function aggregate(cases: CaseRunResult[]): {
	total: number;
	grade: string;
	dimensions: { dimension: Dimension; score: number; weight: number }[];
} {
	const byDim = new Map<Dimension, { score: number; weight: number }>();
	for (const c of cases) {
		if (c.skipped) continue; // 跳过不计入
		const cur = byDim.get(c.dimension) ?? { score: 0, weight: 0 };
		cur.score += c.score * c.weight;
		cur.weight += c.weight;
		byDim.set(c.dimension, cur);
	}
	const dimensions = [...byDim.entries()]
		.map(([dimension, { score, weight }]) => ({ dimension, score: weight ? score / weight : 0, weight }))
		.sort((a, b) => b.weight - a.weight);
	const totalWeight = dimensions.reduce((acc, d) => acc + d.weight, 0);
	const total = totalWeight ? (dimensions.reduce((acc, d) => acc + d.score * d.weight, 0) / totalWeight) * 100 : 0;
	return { total, grade: gradeOf(total), dimensions };
}

export function gradeOf(total100: number): string {
	if (total100 >= 90) return "S";
	if (total100 >= 80) return "A";
	if (total100 >= 70) return "B";
	if (total100 >= 60) return "C";
	return "D";
}

/** 均值/方差(给在线多轮分布)。 */
export function meanStd(values: number[]): { mean: number; std: number } {
	if (values.length === 0) return { mean: 0, std: 0 };
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
	return { mean, std: Math.sqrt(variance) };
}