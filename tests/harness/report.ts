// 输出层:终端评分表 + JSON 报告文件。在线按 provider/model 存档,便于横向对比。
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CaseRunResult } from "./score.js";

export interface SuiteReport {
	kind: "offline" | "real";
	date: string;
	provider?: string;
	model?: string;
	thinking?: string;
	iterations: number;
	skipped: { id: string; reason: string }[];
	total: number;
	grade: string;
	dimensions: { dimension: string; score: number; weight: number }[];
	cases: (CaseRunResult & { perRound?: number[] })[];
}

export function formatGradeColor(grade: string, total100: number): string {
	const color = total100 >= 90 ? "\x1b[32m" : total100 >= 60 ? "\x1b[33m" : "\x1b[31m";
	return `${color}${grade} (${total100.toFixed(1)})${"\x1b[0m"}`;
}

/** 终端打印用例表 + 维度表 + 总分。 */
export function printReport(report: SuiteReport): void {
	console.log(`\n===== ${report.kind === "offline" ? "离线" : "在线"}测试报告 · ${report.date} =====`);
	if (report.kind === "real") {
		console.log(`  模型: ${report.provider}/${report.model}  thinking=${report.thinking ?? "off"}  轮次=${report.iterations}`);
	}
	if (report.skipped.length) {
		console.log(`  [跳过] ${report.skipped.map((s) => `${s.id}(${s.reason})`).join(", ")}`);
	}

	console.log("\n用例得分:");
	console.log("  " + "-".repeat(78));
	for (const c of report.cases) {
		console.log(`  ${c.id.padEnd(9)} ${c.name.padEnd(30)} ${(c.dimension).padEnd(6)} ${(c.score * 100).toFixed(1)}%  ${renderCaseDetail(c)}`);
	}
	console.log("  " + "-".repeat(78));

	console.log("\n维度达成率:");
	for (const d of report.dimensions) {
		const bar = "█".repeat(Math.round(d.score * 20)).padEnd(20, "░");
		console.log(`  ${d.dimension.padEnd(8)} ${bar} ${(d.score * 100).toFixed(1)}%`);
	}
	console.log(`\n总分: ${formatGradeColor(report.grade, report.total)}\n`);
}

function renderCaseDetail(c: CaseRunResult): string {
	if (c.skipped) return "(skipped)";
	const detail = c.detail as unknown;
	if (Array.isArray(detail)) {
		// 在线:每轮得分数组
		const perRound = detail as number[];
		if (perRound.length > 1) {
			const mean = (c.score * 100).toFixed(1);
			const min = (Math.min(...perRound) * 100).toFixed(1);
			const max = (Math.max(...perRound) * 100).toFixed(1);
			return `min=${min}% max=${max}%（n=${perRound.length}）`;
		}
		return "";
	}
	// 离线:返回通过详情摘要
	return "";
}

/** 写入报告 JSON 文件(目录自动创建)。 */
export function writeReport(report: SuiteReport, reportDir: string): string {
	mkdirSync(reportDir, { recursive: true });
	const file = report.kind === "offline"
		? join(reportDir, "latest.offline.json")
		: join(reportDir, `real.${report.provider}.${report.model}.json`);
	writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
	return file;
}