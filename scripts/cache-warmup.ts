/**
 * 在线上下文缓存利用率测试脚本。
 *
 * 用通用 Core Session 驱动在线模型的多轮对话，
 * 把单次请求的 prompt 上下文逐步增长到 ~512k tokens，每轮打印 usage
 * （input / output / cacheRead / cacheWrite / cost），结束后输出汇总表。
 * 缓存命中率等参数请到 DeepSeek 控制台 / 账单核对（本脚本只给客户端观测值）。
 *
 * 缓存前缀稳定性的保证：
 * - 会话层跨轮累积完整历史，agent-loop 每轮把 context.messages 全量重发，
 *   核心循环不触发 compaction，因此前缀逐轮原样重复 → 命中上下文缓存。
 * - 本脚本刻意关闭一切会破坏前缀的因素：固定 systemPrompt（禁止工具）、
 *   不加载 Domain Pack（没有 profile 和工具）、maxTurns: 1。
 *
 * 用法（需 DEEPSEEK_API_KEY，见 .env）：
 *   npm run cache:warmup
 *   npx tsx scripts/cache-warmup.ts --target 512000 --chunk-tokens 24000
 *   npx tsx scripts/cache-warmup.ts --provider deepseek --model deepseek-v4-flash --thinking off
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	createSession,
	createModelCollection,
	getProviderDefinition,
	resolveProviderId,
	DEFAULT_MODEL_IDS,
	type Session,
	type SessionEvent,
} from "../src/index.js";

/* ---------------- CLI 参数 ---------------- */

function argValue(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const providerOverride = argValue("provider");
const modelOverride = argValue("model");
const thinkingOverride = argValue("thinking");
const targetTokens = Number(argValue("target") ?? 512_000) || 512_000;
const chunkTokens = Number(argValue("chunk-tokens") ?? 24_000) || 24_000;
const maxTurns = Number(argValue("max-turns") ?? 80) || 80;
const reportDir = argValue("report-dir") ?? "reports";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const thinkingRaw = thinkingOverride ?? process.env.THINKING_LEVEL ?? "off";
const thinkingLevel: ThinkingLevel = (THINKING_LEVELS as string[]).includes(thinkingRaw)
	? (thinkingRaw as ThinkingLevel)
	: "off";

/* ---------------- 固定 systemPrompt（只输出文字，绝不动工具） ---------------- */

const SYSTEM_PROMPT = `You are a concise Python tutor running a structured self-study session.
Rules:
- Always reply with plain prose only. Never call any tool, never write files, never run code.
- The user feeds you long study passages one part at a time. After each part, reply with a 2-3 sentence summary of that part plus a one-sentence preview of the next topic.
- Keep every reply under 150 words. Do not restate the passage.`;

/* ---------------- 确定性大段文本生成 ---------------- */

const TOPICS = [
	"Python's memory model: objects, references, refcounts, and the garbage collector",
	"List comprehensions and generator expressions: eager vs lazy evaluation",
	"Decorators and how closures compose higher-order behavior",
	"Async/await: the event loop, coroutines, and cooperative scheduling",
	"Context managers and the with statement: protocol methods and cleanup guarantees",
	"Descriptors and the attribute lookup chain (__get__ / __set__ / __delete__)",
	"Metaclasses and the class creation pipeline driven by type()",
	"The iteration protocol: __iter__ / __next__, iterables, iterators, and itertools",
	"Parameter passing, *args / **kwargs, positional-only and keyword-only arguments",
	"The import system: modules, packages, sys.path, and importlib machinery",
	"Exceptions: raise / try / except / finally, and Python 3.11 exception groups",
	"Mutable vs immutable types and how they shape aliasing and equality",
	"Operator overloading and the data-model dunder methods",
	"Type hints: generics, Protocols, and static vs runtime typing",
	"The GIL: why it exists, what it serializes, and common workarounds",
	"String interning, immutable sequences, and memory-efficient containers",
];

const FILLER = [
	"In this part we build the idea from first principles, connecting each new concept to the ones already established so the whole picture stays coherent.",
	"A practical way to verify your mental model is to ask what the interpreter does step by step, then confirm it with a tiny example.",
	"Keep in mind that the same machinery appears at several layers; recognizing the repeated pattern is what makes the topic click.",
	"When the semantics feel ambiguous, fall back to the documented protocol methods, because behavior is ultimately defined there.",
	"Most confusions come from assuming a hidden data structure; the language usually exposes exactly what it keeps in memory.",
	"Working through one concrete trace is worth more than a paragraph of definitions, so hold a single example in mind throughout.",
	"Note how the feature composes with the rest of the language; nothing here is an isolated special case.",
	"If you can restate the mechanism in your own words without hand-waving, you have understood it; otherwise re-read the paragraph.",
	"The distinction between interface and implementation recurs constantly, and this topic is another instance of that split.",
	"Rehearse the explanation once more from memory before moving on; retrieval is what cements the model.",
];

const CHARS_PER_TOKEN = 4; // 英文散文约 4 字符/token

function buildChunk(part: number, targetChars: number): string {
	const topic = TOPICS[part % TOPICS.length];
	const out: string[] = [];
	out.push(`Part ${part} — ${topic}.\n\n`);
	// 主题首段：把话题展开成确定性散文
	out.push(`${FILLER[part % FILLER.length]} `);
	out.push(
		`This part focuses on ${topic.toLowerCase()}. `,
	);
	let len = out.join("").length;
	let i = 0;
	while (len < targetChars) {
		const filler = `${i}.${part}: ${FILLER[(part * 7 + i) % FILLER.length]} `;
		out.push(filler);
		len += filler.length;
		i++;
	}
	let text = out.join("");
	if (text.length > targetChars) text = text.slice(0, targetChars);
	return text;
}

/* ---------------- 辅助 ---------------- */

interface RoundRecord {
	round: number;
	promptTokens: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function fmt(n: number): string {
	return n.toLocaleString("en-US");
}

function pad(n: number, width: number): string {
	return String(n).padStart(width, " ");
}

/** 从快照取最后一条 assistant 消息的 usage（pi-ai 已把 prompt_cache_hit_tokens 折叠进 cacheRead）。 */
function lastAssistantUsage(session: Session): {
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } | undefined;
	messageCount: number;
} {
	const messages = session.exportSnapshot(0).messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } };
		if (m.role === "assistant") {
			return {
				usage: m.usage
					? {
							input: m.usage.input,
							output: m.usage.output,
							cacheRead: m.usage.cacheRead,
							cacheWrite: m.usage.cacheWrite,
							cost: m.usage.cost.total,
						}
					: undefined,
				messageCount: messages.length,
			};
		}
	}
	return { usage: undefined, messageCount: messages.length };
}

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
	const providerId = providerOverride ?? resolveProviderId();
	const def = getProviderDefinition(providerId);
	if (!def) throw new Error(`未知 provider: ${providerId}(可用: deepseek / moonshotai-cn / longcat)`);
	const modelId = modelOverride ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	if (!modelId) throw new Error(`provider ${providerId} 无默认模型,请用 --model 指定`);
	if (def.envVar && !process.env[def.envVar]) {
		throw new Error(`缺少 API key: 请设置环境变量 ${def.envVar}(例如写入 .env)`);
	}

	const models = createModelCollection();

	const model = models.getModel(providerId, modelId);
	if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`);
	const session = createSession({
		models,
		model,
		thinkingLevel,
		systemPrompt: SYSTEM_PROMPT,
		maxTurns: 1, // 系统提示禁止工具，1 回合即结束；护栏防意外多回合
	});

	console.log(`provider: ${providerId}  model: ${modelId}  thinking: ${thinkingLevel}`);
	console.log(`目标上下文: ~${fmt(targetTokens)} tokens  每轮注入: ~${fmt(chunkTokens)} tokens  上限轮数: ${maxTurns}`);
	console.log(`API key: ${def.envVar}=${process.env[def.envVar] ? "已配置" : "缺失"}\n`);

	const chunkChars = Math.max(1, Math.round(chunkTokens * CHARS_PER_TOKEN));
	const rounds: RoundRecord[] = [];
	let lastError: string | undefined;
	let prefixBroken = false;
	let stoppedEarly = false;

	const onEvent = (ev: SessionEvent): void => {
		if (ev.type === "profile") prefixBroken = true; // 不应发生；发生了说明前缀被破坏
		if (ev.type === "done") lastError = ev.errorMessage;
	};

	/** 发送一轮；若失败且历史未被污染（消息数未变）则重试一次。 */
	async function promptWithRetry(text: string): Promise<boolean> {
		for (let attempt = 0; attempt < 2; attempt++) {
			lastError = undefined;
			const before = session.exportSnapshot(0).messages.length;
			try {
				await session.prompt(text, onEvent);
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
			if (!lastError) return true;
			const after = session.exportSnapshot(0).messages.length;
			if (after !== before) {
				// 失败时已写入部分 assistant 消息，重发会破坏消息序列与缓存前缀 → 中止
				return false;
			}
			if (attempt === 0) {
				console.log(`  ⚠ 第 ${rounds.length + 1} 轮请求失败(${lastError})，重试一次…`);
			}
		}
		return false;
	}

	for (let r = 0; r < maxTurns; r++) {
		let text: string;
		if (r === 0) {
			text = "你好，我是来学习 Python 的学生。请开始第一课，讲得简洁一些。";
		} else {
			const chunk = buildChunk(r, chunkChars);
			text = `${chunk}\n\n我已经学习完上面的内容。请用两三句话总结这部分，并预览下一个要点。`;
		}

		const ok = await promptWithRetry(text);
		if (!ok) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮失败且历史已污染，中止。最后错误: ${lastError}`);
			break;
		}

		const { usage, messageCount } = lastAssistantUsage(session);
		if (!usage) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮结束后未找到 assistant usage，中止。`);
			break;
		}

		const record: RoundRecord = {
			round: rounds.length + 1,
			promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cost: usage.cost,
		};
		rounds.push(record);

		const hitRate = record.promptTokens > 0 ? record.cacheRead / record.promptTokens : 0;
		console.log(
			`[Round ${pad(record.round, 2)}] prompt=${fmt(record.promptTokens)}  ` +
				`cacheHit=${fmt(record.cacheRead)}(${(hitRate * 100).toFixed(1)}%)  ` +
				`cacheWrite=${fmt(record.cacheWrite)}  input=${fmt(record.input)}  ` +
				`output=${fmt(record.output)}  cost=$${record.cost.toFixed(5)}  msgs=${messageCount}`,
		);

		if (record.promptTokens >= targetTokens) break;
	}

	/* ---------------- 汇总 ---------------- */
	const total = rounds.reduce(
		(a, r) => ({
			input: a.input + r.input,
			output: a.output + r.output,
			cacheRead: a.cacheRead + r.cacheRead,
			cacheWrite: a.cacheWrite + r.cacheWrite,
			cost: a.cost + r.cost,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	);
	const last = rounds[rounds.length - 1];
	const finalHitRate = last && last.promptTokens > 0 ? last.cacheRead / last.promptTokens : 0;
	const overallHitRate = total.cacheRead + total.cacheWrite > 0 ? total.cacheRead / (total.cacheRead + total.cacheWrite + total.input) : 0;

	console.log("\n================ 汇总 ================");
	console.log(`轮数: ${rounds.length}${stoppedEarly ? "（提前中止）" : ""}${prefixBroken ? "（⚠ 检测到 profile 事件，缓存前缀可能被破坏）" : ""}`);
	if (last) console.log(`最终上下文(prompt tokens): ${fmt(last.promptTokens)}  目标: ~${fmt(targetTokens)}`);
	console.log(`累计 input: ${fmt(total.input)}  output: ${fmt(total.output)}`);
	console.log(`累计 cacheRead: ${fmt(total.cacheRead)}  cacheWrite: ${fmt(total.cacheWrite)}`);
	console.log(`末轮缓存命中率: ${(finalHitRate * 100).toFixed(2)}%  累计(读+写)占比: ${(overallHitRate * 100).toFixed(2)}%`);
	console.log(`估算成本: $${total.cost.toFixed(6)}（cacheRead 按极低价计费；以 DeepSeek 账单为准）`);
	console.log("\n提示: 去 DeepSeek 控制台的用量/账单核对服务端缓存命中率与真实费用。");

	/* ---------------- 报告落盘 ---------------- */
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	mkdirSync(reportDir, { recursive: true });
	const report = {
		generatedAt: new Date().toISOString(),
		provider: providerId,
		model: modelId,
		thinkingLevel,
		systemPrompt: SYSTEM_PROMPT,
		targetTokens,
		chunkTokens,
		maxTurns,
		stoppedEarly,
		prefixBroken,
		total,
		finalHitRate,
		overallHitRate,
		rounds,
	};
	const file = join(reportDir, `cache-warmup-${stamp}.json`);
	writeFileSync(file, JSON.stringify(report, null, 2));
	console.log(`报告已写入: ${file}`);
}

void main();
