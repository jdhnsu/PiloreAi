/**
 * 在线上下文缓存利用率测试 —— 真实使用变体。
 *
 * 与 scripts/cache-warmup.ts 相反：这次完整启用 Agent 的真实行为：
 *   1. 必须调用工具（write_file / read_file / run_code，经 exec 执行）
 *   2. 中途切换各种角色（默认老师集合 Oris / Feynman / Socrates / 自动路由）
 *   3. 模拟真实用户使用（写代码跑代码、贴大段学习材料、概念问答、改 bug）
 *   4. 上下文控制在 ~512k tokens
 *
 * 缓存命中率观察要点：切换角色会换入新的 systemPrompt → 前缀失效，
 * 命中率出现"下跌-恢复"曲线；切回已用过的角色时前缀重新匹配 → 再度命中。
 * 命中率等参数请到 DeepSeek 控制台核对（本脚本只给客户端观测值）。
 *
 * 执行后端：若环境中已设置 EXEC_API_BASE 则直连真实沙箱（还原真实场景）；
 * 未设置时自动启动进程内 mock exec（与 tests/run.ts 一致，run_code 走真实工具链路）。
 *
 * 用法（需 DEEPSEEK_API_KEY，见 .env）：
 *   npm run cache:realistic
 *   npx tsx scripts/cache-realistic.ts --target 512000 --chunk-tokens 20000 --rounds 40
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	createEduSession,
	createModelCollection,
	getProviderDefinition,
	resolveProviderId,
	getDefaultPersonas,
	DEFAULT_MODEL_IDS,
	type EduEvent,
	type Persona,
} from "../src/index.js";
import { createMockExecServer } from "../mock/exec-server.js";

/* ---------------- CLI 参数 ---------------- */

function argValue(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const providerOverride = argValue("provider");
const modelOverride = argValue("model");
const thinkingOverride = argValue("thinking");
const targetTokens = Number(argValue("target") ?? 512_000) || 512_000;
const chunkTokens = Number(argValue("chunk-tokens") ?? 20_000) || 20_000;
const roundCap = Number(argValue("rounds") ?? 70) || 70; // 轮数上限（工具/问答轮不注入材料，增长慢于纯注入）
const turnsPerPrompt = Number(argValue("turns") ?? 6) || 6; // 单次 prompt 的 LLM 回合护栏（工具链需要空间）
const reportDir = argValue("report-dir") ?? "reports";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const thinkingRaw = thinkingOverride ?? process.env.THINKING_LEVEL ?? "off";
const thinkingLevel: ThinkingLevel = (THINKING_LEVELS as string[]).includes(thinkingRaw)
	? (thinkingRaw as ThinkingLevel)
	: "off";

/* ---------------- 确定性大段文本（学习材料） ---------------- */

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
	out.push(`${FILLER[part % FILLER.length]} `);
	out.push(`This part focuses on ${topic.toLowerCase()}. `);
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

/* ---------------- 真实教学场景素材 ---------------- */

const CODE_TASKS = [
	"用 Python 写一个程序打印斐波那契数列的前 10 项，保存到 fib.py 并运行给我看，然后简单讲解这段代码。",
	"用 Python 实现一个快速排序，保存到 quick_sort.py，写个测试用例运行验证排序结果，再讲讲思路。",
	"写一个装饰器用来测量任意函数的执行耗时，保存到 timer.py，跑一个示例验证，并讲解闭包在这里的作用。",
	"用生成器函数实现斐波那契数列，保存到 fib_gen.py，运行输出前 10 项，并说明生成器和普通列表的区别。",
];

const BUGGY_QUICKSORT = `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[0]
    left = [x for x in arr[1:] if x <= pivot]
    right = [x for x in arr[1:] if x > pivot]
    return quicksort(right) + [pivot] + quicksort(left)

print(quicksort([3, 6, 8, 10, 1, 2, 1]))`;

const BUGGY_BUBBLE = `def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j] = arr[j + 1]
                arr[j + 1] = arr[j]
    return arr

print(bubble_sort([5, 2, 9, 1, 5, 6]))`;

const BUGFIX_TASKS = [
	[
		"我写的快速排序输出顺序不对（我期望从小到大），代码在下面。帮我找出问题、修好，保存到 quick_sort_fixed.py 并运行验证。",
		BUGGY_QUICKSORT,
	].join("\n\n```python\n"),
	[
		"我写的冒泡排序结果不对，代码在下面。帮我找出问题、修好，保存到 bubble_sort_fixed.py 并运行验证。",
		BUGGY_BUBBLE,
	].join("\n\n```python\n"),
];

const QUESTIONS = [
	"Python 的 GIL 是什么？它真的让多线程形同虚设吗？",
	"浅拷贝和深拷贝有什么区别？什么情况下会踩坑？",
	"asyncio 的事件循环是怎么工作的？可以讲得明白一点吗？",
	"== 和 is 有什么区别？什么时候必须用 is？",
	"装饰器、生成器、上下文管理器这几个概念之间有什么联系？",
	"Python 3.11 的异常组（ExceptionGroup）解决了什么问题？",
];

type RoundKind = "chunk" | "code" | "question" | "codefix";

/** 每 3 轮切换一次角色（模拟真实用户隔一段时间换教法/切回自由模式），undefined = 保持当前。 */
const PERSONA_ROTATION = ["oris", "feynman", "socrates", null]; // null = 自动路由（基座）
function personaFor(index: number): string | null | undefined {
	if (index % 3 === 0) return PERSONA_ROTATION[(index / 3) % PERSONA_ROTATION.length];
	return undefined;
}

const KIND_CYCLE: RoundKind[] = ["code", "chunk", "question", "chunk", "codefix", "chunk", "question", "chunk"];
function kindFor(index: number): RoundKind {
	return KIND_CYCLE[index % KIND_CYCLE.length];
}

function buildUserMessage(index: number, chunkText: string): string {
	const kind = kindFor(index);
	switch (kind) {
		case "code":
			return CODE_TASKS[(index / KIND_CYCLE.length) % CODE_TASKS.length | 0];
		case "codefix": {
			const [intro, code] = BUGFIX_TASKS[index % BUGFIX_TASKS.length];
			return `${intro}\n\`\`\`python\n${code}\n\`\`\``;
		}
		case "question":
			return QUESTIONS[index % QUESTIONS.length];
		case "chunk":
			return (
				`【学习材料 第 ${index + 1} 部分】\n${chunkText}\n\n` +
				"我已经读完了。请按照你当前的教学方式，用自己的话总结这部分的关键要点，并简单预告下一部分。"
			);
	}
}

/* ---------------- 辅助 ---------------- */

interface RoundRecord {
	round: number;
	persona: string;
	tools: string[];
	/** 本轮结束时的真实上下文 = 最后一个 LLM 回合的 input+cacheRead+cacheWrite。 */
	contextTokens: number;
	/** 本轮全部 LLM 调用的 prompt 之和（含轮内工具链多回合；累计命中率的分母）。 */
	callPromptTokens: number;
	/** 本轮的 LLM 调用次数（含轮内工具链多回合）。 */
	callCount: number;
	/** 本轮累计（所有回合求和）。 */
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

function padStr(s: string, width: number): string {
	return s.length >= width ? s : `${s}${" ".repeat(width - s.length)}`;
}

function personaLabel(p: Persona | undefined): string {
	return p ? p.key : "auto";
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

	// 执行后端：EXEC_API_BASE 可达则直连（真实沙箱），连接失败回退进程内 mock（与 tests/run.ts 一致）
	let mockServer: ReturnType<typeof createMockExecServer> | undefined;
	if (process.env.EXEC_API_BASE) {
		const reachable = await fetch(`${process.env.EXEC_API_BASE.replace(/\/+$/, "")}/health`, {
			signal: AbortSignal.timeout(5_000),
		})
			.then(() => true)
			.catch(() => false);
		if (!reachable) {
			console.log(`  ⚠ 无法连接 EXEC_API_BASE=${process.env.EXEC_API_BASE}，回退进程内 mock 执行服务`);
			process.env.EXEC_API_BASE = undefined;
		}
	}
	if (!process.env.EXEC_API_BASE) {
		const server = createMockExecServer();
		mockServer = server;
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		process.env.EXEC_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}
	console.log(`执行后端: ${process.env.EXEC_API_BASE}${mockServer ? "（进程内 mock，模拟 run_code 输出）" : "（直连沙箱）"}`);

	const personas = getDefaultPersonas();
	const models = createModelCollection();

	const session = createEduSession({
		models,
		providerId,
		modelId,
		thinkingLevel,
		personas, // 真实老师集合：Oris / Feynman / Socrates
		// exec 缺省 = createHttpExecClient()，每次调用读 EXEC_API_BASE（即上面设置的地址）
		maxTurns: turnsPerPrompt, // 工具链护栏：单次 prompt 内最多 N 个 LLM 回合
	});

	console.log(`provider: ${providerId}  model: ${modelId}  thinking: ${thinkingLevel}`);
	console.log(
		`目标上下文: ~${fmt(targetTokens)} tokens  每轮注入材料: ~${fmt(chunkTokens)} tokens  轮数上限: ${roundCap}  单轮回合护栏: ${turnsPerPrompt}`,
	);
	console.log(`老师集合: ${personas.map((p) => p.key).join(" / ")}（自动路由为基座 prompt）\n`);

	const chunkChars = Math.max(1, Math.round(chunkTokens * CHARS_PER_TOKEN));
	const rounds: RoundRecord[] = [];
	let lastError: string | undefined;
	let personaEventCount = 0; // 对话内自然发生的角色切换（模型主动 adopt_persona）
	let prefixBrokenByScript = 0; // 脚本主动切换角色的次数
	let stoppedEarly = false;
	let roundToolCounts: Record<string, number> = {};

	const onEvent = (ev: EduEvent): void => {
		if (ev.type === "persona") personaEventCount++;
		if (ev.type === "tool_start") {
			roundToolCounts[ev.toolName] = (roundToolCounts[ev.toolName] ?? 0) + 1;
		}
		if (ev.type === "done") lastError = ev.errorMessage;
	};

	/** 发送一轮；若失败且历史未被污染（消息数未变）则重试一次。 */
	async function promptWithRetry(text: string): Promise<boolean> {
		for (let attempt = 0; attempt < 2; attempt++) {
			lastError = undefined;
			const before = session.exportSnapshot().messages.length;
			try {
				await session.prompt(text, onEvent);
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
			if (!lastError) return true;
			const after = session.exportSnapshot().messages.length;
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

	for (let r = 0; r < roundCap; r++) {
		roundToolCounts = {};

		// 按计划切换角色（改变 systemPrompt → 缓存前缀失效，这正是要观察的真实行为）
		const target = personaFor(r);
		if (target !== undefined) {
			const currentKey = session.persona?.key ?? null;
			if (currentKey !== target) {
				try {
					session.setPersona(target);
					prefixBrokenByScript++;
				} catch (err) {
					console.log(`  ⚠ 设置角色 ${String(target)} 失败: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}

		const beforeCount = session.exportSnapshot().messages.length;
		const text = buildUserMessage(r, buildChunk(r + 1, chunkChars));

		const ok = await promptWithRetry(text);
		if (!ok) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮失败且历史已污染，中止。最后错误: ${lastError}`);
			break;
		}

		// 差分聚合本轮新增 assistant 消息的 usage（工具链多回合也计入）
		const msgs = session.exportSnapshot().messages;
		const newAssistants = msgs
			.slice(beforeCount)
			.filter((m) => m.role === "assistant" && m.usage) as Extract<(typeof msgs)[number], { role: "assistant" }>[];
		if (newAssistants.length === 0) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮结束后未找到 assistant usage，中止。`);
			break;
		}
		const totals = newAssistants.reduce(
			(a, m) => ({
				input: a.input + m.usage!.input,
				output: a.output + m.usage!.output,
				cacheRead: a.cacheRead + m.usage!.cacheRead,
				cacheWrite: a.cacheWrite + m.usage!.cacheWrite,
				cost: a.cost + m.usage!.cost.total,
			}),
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		);
		const lastUsage = newAssistants[newAssistants.length - 1].usage!;
		const record: RoundRecord = {
			round: rounds.length + 1,
			persona: personaLabel(session.persona),
			tools: Object.keys(roundToolCounts),
			// 真实上下文 = 最后一个 LLM 回合的 prompt（跨回合求和会把轮内多回合重复计入）
			contextTokens: lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite,
			callPromptTokens: totals.input + totals.cacheRead + totals.cacheWrite,
			callCount: newAssistants.length,
			input: totals.input,
			output: totals.output,
			cacheRead: totals.cacheRead,
			cacheWrite: totals.cacheWrite,
			cost: totals.cost,
		};
		rounds.push(record);

		// 累计口径（上下文缓存跨轮共享，累计命中率才是稳定指标；分母=全部 LLM 调用之和）
		const cumulative = rounds.reduce(
			(a, r) => ({
				prompt: a.prompt + r.callPromptTokens,
				cache: a.cache + r.cacheRead + r.cacheWrite,
			}),
			{ prompt: 0, cache: 0 },
		);
		const cumHitRate = cumulative.prompt > 0 ? cumulative.cache / cumulative.prompt : 0;
		const toolTag = record.tools.length ? `[tools:${record.tools.join(",")}]` : "[no tool]";
		console.log(
			`[R${pad(record.round, 2)}][${padStr(record.persona, 8)}] ${toolTag}  ctx=${fmt(record.contextTokens)}  ` +
				`calls=${record.callCount}  cacheHit=${fmt(record.cacheRead)}  input=${fmt(record.input)}  ` +
				`output=${fmt(record.output)}  cum=${(cumHitRate * 100).toFixed(1)}%  cost=$${record.cost.toFixed(5)}`,
		);
		if (process.env.CACHE_DEBUG) {
			for (const m of msgs.slice(beforeCount)) {
				const len = "content" in m && Array.isArray(m.content)
					? m.content.reduce((a: number, b: { type: string; text?: string }) => a + (b.text?.length ?? 0), 0)
					: "content" in m && typeof m.content === "string"
						? m.content.length
						: 0;
				console.log(
					`   └ [${m.role}] len=${len}${m.role === "assistant" && m.usage ? ` usage={input:${m.usage.input},out:${m.usage.output},cacheRead:${m.usage.cacheRead},cacheWrite:${m.usage.cacheWrite},total:${m.usage.totalTokens}}` : ""}`,
				);
			}
		}

		if (record.contextTokens >= targetTokens) break;
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
	const cumulativePrompt = rounds.reduce((a, r) => a + r.callPromptTokens, 0);
	const cumulativeCache = rounds.reduce((a, r) => a + r.cacheRead + r.cacheWrite, 0);
	const overallHitRate = cumulativePrompt > 0 ? cumulativeCache / cumulativePrompt : 0;
	const totalCalls = rounds.reduce((a, r) => a + r.callCount, 0);
	const toolCalls = rounds.reduce((a, r) => a + r.tools.length, 0);
	const toolNameCounts: Record<string, number> = {};
	for (const r of rounds) for (const t of r.tools) toolNameCounts[t] = (toolNameCounts[t] ?? 0) + 1;

	console.log("\n================ 汇总 ================");
	console.log(`轮数: ${rounds.length}  角色切换: 脚本主动 ${prefixBrokenByScript} 次，对话内自然切换 ${personaEventCount} 次`);
	console.log(`LLM 调用: 共 ${totalCalls} 次（含工具链多回合）  工具调用: ${toolCalls} 次 → ${JSON.stringify(toolNameCounts)}`);
	if (last) console.log(`最终上下文(末回合 prompt tokens): ${fmt(last.contextTokens)}  目标: ~${fmt(targetTokens)}${stoppedEarly ? "（提前中止）" : ""}`);
	console.log(`累计 input: ${fmt(total.input)}  output: ${fmt(total.output)}  cacheRead: ${fmt(total.cacheRead)}  cacheWrite: ${fmt(total.cacheWrite)}`);
	console.log(`累计缓存命中率: ${(overallHitRate * 100).toFixed(2)}%`);
	console.log(`估算成本: $${total.cost.toFixed(6)}（cacheRead 按极低价计费；以 DeepSeek 账单为准）`);
	console.log("\n提示: 角色切换 / update_teaching 会换入新 systemPrompt → 前缀缓存失效、命中率下跌后恢复；去 DeepSeek 控制台核对服务端命中率与账单。");

	/* ---------------- 报告落盘 ---------------- */
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	mkdirSync(reportDir, { recursive: true });
	const report = {
		generatedAt: new Date().toISOString(),
		provider: providerId,
		model: modelId,
		thinkingLevel,
		targetTokens,
		chunkTokens,
		roundCap,
		turnsPerPrompt,
		execBase: process.env.EXEC_API_BASE,
		stoppedEarly,
		personaSwitchCount: prefixBrokenByScript,
		naturalPersonaSwitches: personaEventCount,
		toolCallCounts: toolNameCounts,
		total,
		overallHitRate,
		rounds,
	};
	const file = join(reportDir, `cache-realistic-${stamp}.json`);
	writeFileSync(file, JSON.stringify(report, null, 2));
	console.log(`报告已写入: ${file}`);

	if (mockServer) {
		await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
	}
}

void main();
