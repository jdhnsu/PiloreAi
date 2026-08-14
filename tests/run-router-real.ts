import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	DEFAULT_MODEL_IDS,
	getProviderDefinition,
	resolveProviderId,
} from "../src/index.js";
import { routerRealCases, type RouterMetric } from "./cases/router-real.js";
import {
	runRouterCaseRound,
	type RouterCaseRoundEvidence,
} from "./harness/router-real-driver.js";

const METRICS: RouterMetric[] = ["activation", "nonActivation", "stability", "switching"];
const METRIC_LABELS: Record<RouterMetric, string> = {
	activation: "应激活命中率",
	nonActivation: "不过度激活率",
	stability: "保持稳定率",
	switching: "应切换命中率",
};
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CATEGORY_THRESHOLD = 0.8;
const CASE_THRESHOLD = 2 / 3;

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} 必须是正整数`);
	return value;
}

function nonNegativeInteger(raw: string | undefined, fallback: number, name: string): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} 必须是非负整数`);
	return value;
}

function wait(milliseconds: number): Promise<void> {
	return milliseconds > 0
		? new Promise((resolve) => setTimeout(resolve, milliseconds))
		: Promise.resolve();
}

function safeFilePart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
	const providerId = argValue("provider") ?? resolveProviderId();
	const provider = getProviderDefinition(providerId);
	if (!provider) throw new Error(`未知 provider: ${providerId}`);
	if (!process.env[provider.envVar]?.trim()) {
		throw new Error(`真实路由测试需要环境变量 ${provider.envVar}`);
	}
	const modelId = argValue("model") ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	if (!modelId) throw new Error(`provider ${providerId} 没有默认模型，请通过 --model 指定`);
	const rawThinking = argValue("thinking") ?? process.env.THINKING_LEVEL ?? "off";
	if (!THINKING_LEVELS.has(rawThinking as ThinkingLevel)) throw new Error(`未知 thinking level: ${rawThinking}`);
	const thinkingLevel = rawThinking as ThinkingLevel;
	const iterations = positiveInteger(argValue("iterations"), 3, "iterations");
	const retries = nonNegativeInteger(argValue("retries"), 2, "retries");
	const delayMs = nonNegativeInteger(argValue("delay-ms"), 1500, "delay-ms");
	const filter = argValue("filter");
	const reportDir = argValue("report-dir") ?? "tests/report";
	const selected = routerRealCases.filter((definition) =>
		!filter || `${definition.id} ${definition.name}`.toLowerCase().includes(filter.toLowerCase()),
	);
	if (!selected.length) throw new Error(`没有匹配的路由场景: ${filter ?? "<all>"}`);

	console.log(`\nCode Pack 真实路由评测: ${providerId}/${modelId} thinking=${thinkingLevel} iterations=${iterations}`);
	const caseResults: Array<{
		id: string;
		name: string;
		metric: RouterMetric;
		successRate: number;
		passed: boolean;
		rounds: Array<RouterCaseRoundEvidence & { attemptCount: number; transientErrors: string[] }>;
	}> = [];

	for (const definition of selected) {
		const metric = definition.turns.find((turn) => turn.metric)?.metric;
		if (!metric) throw new Error(`${definition.id} 缺少计分轮`);
		const rounds: Array<RouterCaseRoundEvidence & { attemptCount: number; transientErrors: string[] }> = [];
		for (let round = 0; round < iterations; round += 1) {
			process.stdout.write(`  ${definition.id} ${definition.name} [${round + 1}/${iterations}] ... `);
			let evidence: RouterCaseRoundEvidence | undefined;
			const transientErrors: string[] = [];
			let attemptCount = 0;
			for (let attempt = 0; attempt <= retries; attempt += 1) {
				attemptCount += 1;
				evidence = await runRouterCaseRound(definition, { providerId, modelId, thinkingLevel });
				if (evidence.errorCount === 0) break;
				transientErrors.push(...evidence.turns.flatMap((turn) => turn.error ? [turn.error] : []));
				if (attempt < retries) await wait(delayMs * (attempt + 1));
			}
			if (!evidence) throw new Error(`${definition.id} 未产生评测证据`);
			rounds.push({ ...evidence, attemptCount, transientErrors });
			console.log(`${evidence.passed ? "PASS" : "FAIL"}${attemptCount > 1 ? ` (attempts=${attemptCount})` : ""}`);
			await wait(delayMs);
		}
		const successRate = rounds.filter((round) => round.passed).length / iterations;
		caseResults.push({
			id: definition.id,
			name: definition.name,
			metric,
			successRate,
			passed: successRate >= CASE_THRESHOLD,
			rounds,
		});
	}

	const metrics = Object.fromEntries(METRICS.map((metric) => {
		const rounds = caseResults
			.filter((result) => result.metric === metric)
			.flatMap((result) => result.rounds);
		const rate = rounds.length
			? rounds.filter((round) => round.measuredPassed).length / rounds.length
			: 1;
		return [metric, { rate, passed: rate >= CATEGORY_THRESHOLD, samples: rounds.length }];
	})) as Record<RouterMetric, { rate: number; passed: boolean; samples: number }>;
	const allRounds = caseResults.flatMap((result) => result.rounds);
	const thrashCount = allRounds.reduce((sum, round) => sum + round.thrashCount, 0);
	const errorCount = allRounds.reduce((sum, round) => sum + round.errorCount, 0);
	const failedCases = caseResults.filter((result) => !result.passed).map((result) => result.id);
	const passed = failedCases.length === 0
		&& METRICS.every((metric) => metrics[metric].passed)
		&& thrashCount === 0
		&& errorCount === 0;

	console.log("\n分类指标:");
	for (const metric of METRICS) {
		const result = metrics[metric];
		console.log(`  ${METRIC_LABELS[metric]}: ${percent(result.rate)} (n=${result.samples}) ${result.passed ? "PASS" : "FAIL"}`);
	}
	console.log(`  路由抖动回合: ${thrashCount} ${thrashCount === 0 ? "PASS" : "FAIL"}`);
	console.log(`  模型错误回合: ${errorCount} ${errorCount === 0 ? "PASS" : "FAIL"}`);
	if (failedCases.length) console.log(`  未达到逐场景 ${percent(CASE_THRESHOLD)} 阈值: ${failedCases.join(", ")}`);

	const date = new Date();
	const report = {
		kind: "router-real",
		date: date.toISOString(),
		provider: providerId,
		model: modelId,
		thinking: thinkingLevel,
		iterations,
		retries,
		delayMs,
		thresholds: { perCase: CASE_THRESHOLD, perMetric: CATEGORY_THRESHOLD, maxThrashTurns: 0, maxErrorTurns: 0 },
		passed,
		metrics,
		thrashCount,
		errorCount,
		failedCases,
		cases: caseResults,
	};
	mkdirSync(reportDir, { recursive: true });
	const timestamp = date.toISOString().replace(/[:.]/g, "-");
	const reportFile = join(
		reportDir,
		`router-real.${safeFilePart(providerId)}.${safeFilePart(modelId)}.${timestamp}.json`,
	);
	writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
	console.log(`\n结果: ${passed ? "PASS" : "FAIL"}`);
	console.log(`报告: ${reportFile}\n`);
	if (!passed) process.exitCode = 1;
}

main().catch((error) => {
	console.error(`[router-real] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
