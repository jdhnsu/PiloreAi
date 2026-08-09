// Agent 核心测试运行器(入口)。
// 用法:
//   npx tsx tests/run.ts --mode offline|real|all [--iterations N] [--filter sub] [--provider p] [--model m] [--thinking off] [--max-turns N] [--report-dir dir]
// 详见 tests/TEST-SPEC.md §4 运行方式。
import "dotenv/config";
import { aggregate, type CaseRunResult } from "./harness/score.js";
import { offlineCases } from "./cases/offline/index.js";
import { onlineCases } from "./cases/online/index.js";
import { runOnlineEvidence } from "./harness/session-driver.js";
import { ensureMockExec, closeMockExec } from "./harness/exec-mock.js";
import { printReport, writeReport, type SuiteReport } from "./harness/report.js";
import {
	createModelCollection,
	getProviderDefinition,
	DEFAULT_MODEL_IDS,
	resolveProviderId,
} from "../src/index.js";

type Mode = "offline" | "real" | "all";

function argValue(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const mode = (argValue("mode") ?? "offline") as Mode;
const iterations = Number(argValue("iterations") ?? 3) || 3;
const filterStr = argValue("filter");
const providerOverride = argValue("provider");
const modelOverride = argValue("model");
const thinkingOverride = argValue("thinking");
const maxTurnsUser = argValue("max-turns");
const maxTurns = maxTurnsUser ? Number(maxTurnsUser) : 8;
const reportDir = argValue("report-dir") ?? "tests/report";

function matches(c: { id: string; name: string }): boolean {
	return !filterStr || `${c.id} ${c.name}`.includes(filterStr);
}

/* ---------------- 离线 ---------------- */
async function runOffline(): Promise<SuiteReport> {
	const cases: CaseRunResult[] = [];
	for (const c of offlineCases) {
		if (!matches(c)) continue;
		const roundRates: number[] = [];
		for (let r = 0; r < iterations; r++) {
			const checks: { name: string; pass: boolean; detail?: string }[] = [];
			const ctx = {
				check: (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail }),
				getChecks: () => checks,
			};
			try {
				await c.run(ctx);
			} catch (err) {
				checks.push({ name: "运行抛错", pass: false, detail: err instanceof Error ? err.message : String(err) });
			}
			const ok = checks.filter((x) => x.pass).length;
			roundRates.push(checks.length ? ok / checks.length : 1);
		}
		const score = roundRates.reduce((a, b) => a + b, 0) / roundRates.length;
		cases.push({ id: c.id, name: c.name, dimension: c.dimension, weight: c.weight, score, detail: { rounds: roundRates } });
	}
	const agg = aggregate(cases);
	return {
		kind: "offline",
		date: new Date().toISOString(),
		iterations,
		skipped: [],
		total: agg.total,
		grade: agg.grade,
		dimensions: agg.dimensions,
		cases: cases as never,
	};
}

/* ---------------- 在线 ---------------- */
async function runOnline(): Promise<SuiteReport> {
	const providerId = providerOverride ?? resolveProviderId();
	const def = getProviderDefinition(providerId);
	if (!def) throw new Error(`未知 provider: ${providerId}(可用: deepseek / moonshotai-cn / longcat)`);
	const modelId = modelOverride ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	if (!modelId) throw new Error(`provider ${providerId} 无默认模型,请用 --model 指定`);
	process.env.PROVIDER = providerId;
	if (modelId) process.env.MODEL_ID = modelId;
	if (thinkingOverride) process.env.THINKING_LEVEL = thinkingOverride;

	const models = createModelCollection();
	const keyEnv = def.envVar;
	const hasKey = !keyEnv || !!process.env[keyEnv];

	const cases: CaseRunResult[] = [];
	const skipped: { id: string; reason: string }[] = [];
	for (const c of onlineCases) {
		if (!matches(c)) continue;
		if (!hasKey) {
			skipped.push({ id: c.id, reason: "no-key" });
			cases.push({ id: c.id, name: c.name, dimension: c.dimension, weight: c.weight, score: 0, detail: [], skipped: true });
			continue;
		}
		const perRound: number[] = [];
		for (let r = 0; r < iterations; r++) {
			const ev = await runOnlineEvidence({
				models,
				providerId,
				modelId,
				maxTurns,
				prompts: c.prompts,
			});
			const totalWeight = c.rules.reduce((a, rl) => a + rl.weight, 0);
			const gained = c.rules.reduce((a, rl) => a + rl.judge(ev) * rl.weight, 0);
			perRound.push(totalWeight ? gained / totalWeight : 0);
		}
		const mean = perRound.reduce((a, b) => a + b, 0) / perRound.length;
		cases.push({ id: c.id, name: c.name, dimension: c.dimension, weight: c.weight, score: mean, detail: perRound });
	}
	const agg = aggregate(cases);
	return {
		kind: "real",
		date: new Date().toISOString(),
		provider: providerId,
		model: modelId,
		thinking: process.env.THINKING_LEVEL,
		iterations,
		skipped,
		total: agg.total,
		grade: agg.grade,
		dimensions: agg.dimensions,
		cases: cases as never,
	};
}

async function main() {
	// 离线/在线共用进程内 mock exec,让 run_code 走真实工具链路(不依赖外网沙箱)
	await ensureMockExec();

	if (mode === "offline" || mode === "all") {
		const report = await runOffline();
		printReport(report);
		const file = writeReport(report, reportDir);
		console.log(`[offline] 报告已写入: ${file}`);
	}
	if (mode === "real" || mode === "all") {
		try {
			const report = await runOnline();
			printReport(report);
			const file = writeReport(report, reportDir);
			console.log(`[real] 报告已写入: ${file}`);
		} catch (err) {
			console.error(`[real] 运行失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// 释放 mock exec 的事件循环,便于脚本正常退出
	await closeMockExec();
}

// 顶层标记:允许作为被 import 调用(测试脚本)
export { main };

void main();