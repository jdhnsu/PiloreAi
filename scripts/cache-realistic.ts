/**
 * 在线上下文缓存利用率测试 —— 真实使用变体。
 *
 * 与 scripts/cache-warmup.ts 相反：这次完整启用 Agent 的真实行为：
 *   1. 必须调用工具（write_file / read_file / run_code，经 exec 执行）
 *   2. 中途切换各种角色（默认老师集合 Oris / Feynman / Socrates / 自动路由）
 *   3. 模拟真实用户使用（写代码跑代码、贴大段学习材料、概念问答、改 bug）
 *   4. 上下文控制在 ~512k tokens
 *
 * 缓存命中率观察要点：systemPrompt 固定，角色方法论通过只追加上下文进入历史；
 * 报告用请求级 telemetry 验证切换轮仍能复用此前公共前缀。
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { AgentMessage, ThinkingLevel } from "@pilore/pi-agent-core";
import {
	createCodeMentorSession,
	createModelCollection,
	getProviderDefinition,
	resolveProviderId,
	getDefaultCodeProfiles,
	DEFAULT_MODEL_IDS,
	type SessionEvent,
	type SessionSnapshot,
	type LlmTelemetryEvent,
	type ProfileDefinition,
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
const minRounds = Math.max(0, Number(argValue("min-rounds") ?? 0) || 0); // 严格对照时可要求达到目标 token 后继续到指定轮数
const turnsPerPrompt = Number(argValue("turns") ?? 6) || 6; // 单次 prompt 的 LLM 回合护栏（工具链需要空间）
const reportDir = argValue("report-dir") ?? "reports";
const resumeArg = argValue("resume"); // 断点续传：--resume <前次报告.json>，从保存的快照继续
// --mini：面向本地小模型（如 qwen2.5-3b）的轻量模式。
// 完整教学 systemPrompt 对 3B 模型过重，工具触发率极低；精简 prompt 明确指示
// 写码必须先 write_file + run_code，并把注入量/回合护栏收紧，让 8K 窗口内多跑工具轮。
const miniMode = process.argv.includes("--mini");

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

/* ---------------- mini 模式：面向小模型的精简 systemPrompt ---------------- */

const MINI_SYSTEM_PROMPT = `You are a Python coding tutor.
Tools you MUST use when relevant:
- activate_toolset(key): load a tool group before using its tools. Groups: workspace (read/write files), execution (run code).
- write_file(path, content): save code to the workspace. Use this whenever the user asks you to write a program.
- run_code(sandbox, entry): execute a saved file. Use this right after writing a file to show its output.
- read_file(path): inspect an existing file.
- adopt_profile(key): switch teaching style. Keys: oris, feynman, socrates. Use it only when the user asks for a different style.
Rules:
- When the user asks to write or run code, ALWAYS call activate_toolset first, then write_file then run_code; do not just print the code.
- After running, reply with a 2-3 sentence explanation.
- Keep replies under 80 words.`;

/** 每 3 轮切换一次 Profile（模拟真实用户隔一段时间换教法/切回自由模式），undefined = 保持当前。 */
const PROFILE_ROTATION = ["oris", "feynman", "socrates", null]; // null = 自动路由（基座）
function profileFor(index: number): string | null | undefined {
	if (index % 3 === 0) return PROFILE_ROTATION[(index / 3) % PROFILE_ROTATION.length];
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

/** 按 logicalRequestId 聚合的单个逻辑调用；telemetry 请求级归属的事实源。 */
interface LogicalRequestState {
	callIndex: number;
	profileKey: string | null;
	start: Extract<LlmTelemetryEvent, { type: "logical_request_start" }>;
	end?: Extract<LlmTelemetryEvent, { type: "logical_request_end" }>;
	attempts: number;
}

interface RoundRecord {
	round: number;
	profile: string;
	tools: string[];
	/** 本轮激活的工具集（activate_toolset 触发）。 */
	toolsets: string[];
	/** 本轮结束时的真实上下文 = 最后一个 LLM 回合的 input+cacheRead+cacheWrite。 */
	contextTokens: number;
	/** 本轮全部 LLM 调用的 prompt 之和（含轮内工具链多回合；累计命中率的分母）。 */
	callPromptTokens: number;
	/** 本轮的 LLM 调用次数（含轮内工具链多回合）。 */
	callCount: number;
	/** 成功写入历史的 assistant 消息数，用于与真实调用数对照。 */
	assistantCallCount: number;
	/** provider 层真实 HTTP 请求数与其中的重试数。 */
	httpRequestCount: number;
	retryCount: number;
	/** 本轮是否发生脚本或模型 Profile 切换。 */
	profileTransition: boolean;
	/** 本轮首个逻辑调用与上次调用共享的完整消息数。 */
	commonPrefixMessages: number;
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

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
	const providerId = providerOverride ?? resolveProviderId();
	const def = getProviderDefinition(providerId);
	if (!def) throw new Error(`未知 provider: ${providerId}(可用: deepseek / moonshotai-cn / longcat / ollama)`);
	const modelId = modelOverride ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	if (!modelId) throw new Error(`provider ${providerId} 无默认模型,请用 --model 指定`);
	// Ollama 本地服务免 key（ambient 占位 key）；其余 provider 需要 API key。
	if (def.id !== "ollama" && def.envVar && !process.env[def.envVar]) {
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

	const profiles: ProfileDefinition[] = getDefaultCodeProfiles();
	const models = createModelCollection();

	// --resume：从上次报告恢复快照与已跑轮次，续跑到目标 token（DeepSeek 前缀缓存可继续命中）
	let previousReport: { rounds: RoundRecord[]; requests: unknown[]; snapshot?: SessionSnapshot } | undefined;
	if (resumeArg) {
		previousReport = JSON.parse(readFileSync(resumeArg, "utf8")) as { rounds: RoundRecord[]; requests: unknown[]; snapshot?: SessionSnapshot };
		if (!previousReport.snapshot) throw new Error(`--resume 报告缺少 snapshot 字段，无法续跑`);
		console.log(
			`续跑模式: 已跑 ${previousReport.rounds.length} 轮（上下文 ${fmt(previousReport.rounds.at(-1)?.contextTokens ?? 0)} tokens），从第 ${previousReport.rounds.length + 1} 轮继续`,
		);
	}
	const resumeRounds = previousReport?.rounds.length ?? 0;

	// telemetry 请求级归属：按 logicalRequestId 聚合 start/end/attempts；
	// callIndex 全局递增，轮归属用 callIndex 边界，不受事件到达顺序（异步 end）影响。
	const logicalRequests = new Map<string, LogicalRequestState>();
	let maxCallIndexSeen = 0;

	const session = createCodeMentorSession({
		models,
		providerId,
		modelId,
		thinkingLevel,
		systemPrompt: miniMode ? MINI_SYSTEM_PROMPT : undefined, // mini 模式：精简指令，提高小模型工具触发率
		profiles, // code pack 默认 Profile：Oris / Feynman / Socrates
		snapshot: resumeRounds > 0 ? previousReport!.snapshot : undefined, // 续跑恢复：消息历史 / 激活 profile / 工具集
		llmTelemetry: {
			onEvent: (event) => {
				switch (event.type) {
					case "logical_request_start":
						maxCallIndexSeen = Math.max(maxCallIndexSeen, event.callIndex);
						logicalRequests.set(event.logicalRequestId, {
							callIndex: event.callIndex,
							profileKey: event.profileKey,
							start: event,
							attempts: 0,
						});
						break;
					case "http_attempt_start": {
						const request = logicalRequests.get(event.logicalRequestId);
						if (request) request.attempts += 1;
						break;
					}
					case "logical_request_end": {
						const request = logicalRequests.get(event.logicalRequestId);
						if (request) request.end = event;
						break;
					}
				}
			},
		},
			// exec 缺省 = createHttpExecClient()，每次调用读 EXEC_API_BASE（即上面设置的地址）
			maxTurns: turnsPerPrompt, // 工具链护栏：单次 prompt 内最多 N 个 LLM 回合
		});

	console.log(`provider: ${providerId}  model: ${modelId}  thinking: ${thinkingLevel}`);
	console.log(
		`目标上下文: ~${fmt(targetTokens)} tokens  每轮注入材料: ~${fmt(chunkTokens)} tokens  轮数上限: ${roundCap}  单轮回合护栏: ${turnsPerPrompt}`,
	);
	console.log(`code pack profiles: ${profiles.map((p) => p.key).join(" / ")}（自动路由为基座 prompt）${miniMode ? "  模式: mini（精简 prompt，适合小模型）" : ""}\n`);

	const chunkChars = Math.max(1, Math.round(chunkTokens * CHARS_PER_TOKEN));
	// mini 模式：8K 窗口内工具链多回合消耗快，注入量减半、回合护栏降到 4，避免窗口溢出。
	const effectiveChunkChars = miniMode ? Math.max(1, Math.round(chunkChars / 2)) : chunkChars;
	const rounds: RoundRecord[] = previousReport?.rounds.slice() ?? []; // 续跑时合并已跑轮次（累计统计为完整会话）
	let lastError: string | undefined;
	let profileEventCount = 0; // 对话内自然发生的 Profile 切换（模型主动 adopt_profile）
	let prefixBrokenByScript = 0; // 脚本主动切换 Profile 的次数
	let stoppedEarly = false;
	let roundToolCounts: Record<string, number> = {};
	let roundToolsetActive: string[] = [];

	const onEvent = (ev: SessionEvent): void => {
		if (ev.type === "profile") profileEventCount++;
		if (ev.type === "toolset" && ev.active && !roundToolsetActive.includes(ev.toolset)) roundToolsetActive.push(ev.toolset);
		if (ev.type === "tool_start") {
			roundToolCounts[ev.toolName] = (roundToolCounts[ev.toolName] ?? 0) + 1;
		}
		if (ev.type === "done") lastError = ev.errorMessage;
	};

	/** 发送一轮；失败且历史未被污染（消息数未变）则重试一次；污染则回滚本轮消息并跳过（不中止）。 */
	async function promptWithRetry(text: string): Promise<"ok" | "skip" | "abort"> {
		for (let attempt = 0; attempt < 2; attempt++) {
			lastError = undefined;
			const before = session.exportSnapshot(0).messages.length;
			try {
				await session.prompt(text, onEvent);
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
			if (!lastError) return "ok";
			const after = session.exportSnapshot(0).messages.length;
			if (after !== before) {
				// 失败时已写入部分 assistant 消息：回滚本轮新增（含注入文本），跳过本轮继续，不破坏前缀
			session.runtime.agent.state.messages = (session.exportSnapshot(0).messages as AgentMessage[]).slice(0, before);
				console.log(`  ⚠ 第 ${rounds.length + 1} 轮失败(${lastError})且历史已污染，已回滚本轮消息，跳过本轮继续。`);
				return "skip";
			}
			if (attempt === 0) {
				console.log(`  ⚠ 第 ${rounds.length + 1} 轮请求失败(${lastError})，重试一次…`);
			}
		}
		return "abort";
	}

	for (let r = resumeRounds; r < roundCap; r++) {
		roundToolCounts = {};
		roundToolsetActive = [];

		const boundaryCallIndex = maxCallIndexSeen; // 本轮归属边界：callIndex > 该值的请求属于本轮
		const profileEventsBefore = profileEventCount;
		let scriptSwitchedThisRound = false;
		// 按计划切换 Profile；只追加 Profile 上下文，不再改写 systemPrompt。
		const target = profileFor(r);
		if (target !== undefined) {
			const currentKey = session.profile;
			if (currentKey !== target) {
				try {
					session.setProfile(target);
					prefixBrokenByScript++;
					scriptSwitchedThisRound = true;
				} catch (err) {
					console.log(`  ⚠ 设置 Profile ${String(target)} 失败: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}

		const beforeCount = session.exportSnapshot(0).messages.length;
		const text = buildUserMessage(r, buildChunk(r + 1, effectiveChunkChars));

		const result = await promptWithRetry(text);
		if (result === "abort") {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮失败且重试无效，中止。最后错误: ${lastError}`);
			break;
		}
		if (result === "skip") continue; // 失败轮已回滚，不统计，下一轮继续

		// assistant 消息用于核对历史；usage 与请求计数以 telemetry 为事实源。
		const msgs = session.exportSnapshot(0).messages as AgentMessage[];
		const newAssistants = msgs
			.slice(beforeCount)
			.filter((m) => m.role === "assistant" && m.usage) as Extract<(typeof msgs)[number], { role: "assistant" }>[];
		if (newAssistants.length === 0) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮结束后未找到 assistant usage，中止。`);
			break;
		}
		// 按 logicalRequestId/callIndex 归属本轮请求：callIndex 全局递增，与事件到达顺序无关。
		const roundRequests = [...logicalRequests.values()]
			.filter((request) => request.callIndex > boundaryCallIndex)
			.sort((a, b) => a.callIndex - b.callIndex);
		if (roundRequests.length === 0) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮结束后未归属到任何逻辑调用，中止。`);
			break;
		}
		// logical_request_end 由 streamFn 异步 emit；prompt resolve 前通常已到达，这里做防御性等待。
		for (let wait = 0; wait < 40 && !roundRequests.every((request) => request.end); wait += 1) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const completeRequests = roundRequests.filter((request) => request.end);
		if (completeRequests.length === 0) {
			stoppedEarly = true;
			console.log(`  ✗ 第 ${rounds.length + 1} 轮逻辑调用均无 logical_request_end，中止。`);
			break;
		}
		if (completeRequests.length !== roundRequests.length) {
			console.log(`  ⚠ 第 ${rounds.length + 1} 轮有 ${roundRequests.length - completeRequests.length} 个调用缺少 end，仅统计已完成部分。`);
		}
		const totals = completeRequests.reduce(
			(a, request) => ({
				input: a.input + request.end!.usage.input,
				output: a.output + request.end!.usage.output,
				cacheRead: a.cacheRead + request.end!.usage.cacheRead,
				cacheWrite: a.cacheWrite + request.end!.usage.cacheWrite,
				cost: a.cost + request.end!.usage.cost.total,
			}),
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		);
		const lastUsage = completeRequests[completeRequests.length - 1].end!.usage;
		const record: RoundRecord = {
			round: rounds.length + 1,
			profile: session.profile ?? "auto",
			tools: Object.keys(roundToolCounts),
			toolsets: roundToolsetActive,
			// 真实上下文 = 最后一个 LLM 回合的 prompt（跨回合求和会把轮内多回合重复计入）
			contextTokens: lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite,
			callPromptTokens: totals.input + totals.cacheRead + totals.cacheWrite,
			callCount: roundRequests.length,
			assistantCallCount: newAssistants.length,
			httpRequestCount: roundRequests.reduce((a, request) => a + request.attempts, 0),
			retryCount: roundRequests.reduce((a, request) => a + Math.max(0, request.attempts - 1), 0),
			profileTransition: scriptSwitchedThisRound || profileEventCount > profileEventsBefore,
			commonPrefixMessages: roundRequests[0]?.start.commonPrefixMessages ?? 0,
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
				cache: a.cache + r.cacheRead,
			}),
			{ prompt: 0, cache: 0 },
		);
		const cumHitRate = cumulative.prompt > 0 ? cumulative.cache / cumulative.prompt : 0;
		const toolTag = record.tools.length ? `[tools:${record.tools.join(",")}]` : "[no tool]";
		const toolsetTag = record.toolsets.length ? `[ts:${record.toolsets.join(",")}]` : "";
		console.log(
			`[R${pad(record.round, 2)}][${padStr(record.profile, 8)}] ${toolTag}${toolsetTag}  ctx=${fmt(record.contextTokens)}  ` +
				`calls=${record.callCount}/http=${record.httpRequestCount}/retry=${record.retryCount}  cacheHit=${fmt(record.cacheRead)}  input=${fmt(record.input)}  ` +
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

		if (record.contextTokens >= targetTokens && rounds.length >= minRounds) break;
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
	const cumulativeCache = rounds.reduce((a, r) => a + r.cacheRead, 0);
	const overallHitRate = cumulativePrompt > 0 ? cumulativeCache / cumulativePrompt : 0;
	const totalCalls = rounds.reduce((a, r) => a + r.callCount, 0);
	const totalAssistantCalls = rounds.reduce((a, r) => a + r.assistantCallCount, 0);
	const totalHttpRequests = rounds.reduce((a, r) => a + r.httpRequestCount, 0);
	const totalRetries = rounds.reduce((a, r) => a + r.retryCount, 0);
	const toolCalls = rounds.reduce((a, r) => a + r.tools.length, 0);
	const toolNameCounts: Record<string, number> = {};
	for (const r of rounds) for (const t of r.tools) toolNameCounts[t] = (toolNameCounts[t] ?? 0) + 1;
	const toolsetNameCounts: Record<string, number> = {};
	for (const r of rounds) for (const t of r.toolsets) toolsetNameCounts[t] = (toolsetNameCounts[t] ?? 0) + 1;
	function groupStats(records: RoundRecord[]) {
		const prompt = records.reduce((sum, record) => sum + record.callPromptTokens, 0);
		const cacheRead = records.reduce((sum, record) => sum + record.cacheRead, 0);
		return {
			rounds: records.length,
			calls: records.reduce((sum, record) => sum + record.callCount, 0),
			input: records.reduce((sum, record) => sum + record.input, 0),
			cacheRead,
			promptTokens: prompt,
			hitRate: prompt > 0 ? cacheRead / prompt : 0,
		};
	}
	const transitionStats = groupStats(rounds.filter((round) => round.profileTransition));
	const stableStats = groupStats(rounds.filter((round) => !round.profileTransition));

	console.log("\n================ 汇总 ================");
	console.log(`轮数: ${rounds.length}  Profile 切换: 脚本主动 ${prefixBrokenByScript} 次，对话内自然切换 ${profileEventCount} 次`);
	console.log(`LLM 调用: ${totalCalls} 次；assistant 成功消息: ${totalAssistantCalls}；HTTP: ${totalHttpRequests}（重试 ${totalRetries}）`);
	console.log(`工具调用: ${toolCalls} 次 → ${JSON.stringify(toolNameCounts)}`);
	console.log(`工具集激活: ${JSON.stringify(toolsetNameCounts)}`);
	if (last) console.log(`最终上下文(末回合 prompt tokens): ${fmt(last.contextTokens)}  目标: ~${fmt(targetTokens)}${stoppedEarly ? "（提前中止）" : ""}`);
	console.log(`累计 input: ${fmt(total.input)}  output: ${fmt(total.output)}  cacheRead: ${fmt(total.cacheRead)}  cacheWrite: ${fmt(total.cacheWrite)}`);
	console.log(`累计缓存命中率: ${(overallHitRate * 100).toFixed(2)}%`);
	console.log(`切换轮命中率: ${(transitionStats.hitRate * 100).toFixed(2)}%  稳定轮命中率: ${(stableStats.hitRate * 100).toFixed(2)}%`);
	console.log(`估算成本: $${total.cost.toFixed(6)}（cacheRead 按极低价计费；以 DeepSeek 账单为准）`);
	console.log("\n提示: systemPrompt 应全程保持同一哈希；activate_toolset 会改变激活工具集（tools 定义），关注其对前缀缓存的影响；去 DeepSeek 控制台核对服务端命中率与账单。");

	/* ---------------- 报告落盘 ---------------- */
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	mkdirSync(reportDir, { recursive: true });
	// 请求级归属审计：每个逻辑调用一份（start 同步、end 异步到达后按身份补全）；续跑时合并前次报告
	const requestsAudit = [
		...(previousReport?.requests ?? []),
		...[...logicalRequests.values()]
			.sort((a, b) => a.callIndex - b.callIndex)
			.map((request) => ({
				callIndex: request.callIndex,
				profileKey: request.start.profileKey,
				attempts: request.attempts,
				commonPrefixMessages: request.start.commonPrefixMessages,
				stopReason: request.end?.stopReason ?? null,
				usage: request.end?.usage ?? null,
			})),
	];
	const report = {
		generatedAt: new Date().toISOString(),
		pack: "code",
		provider: providerId,
		model: modelId,
		thinkingLevel,
		mode: miniMode ? "mini" : "full",
		resumed: resumeRounds > 0,
		resumeFrom: resumeRounds,
		targetTokens,
		chunkTokens,
		roundCap,
		minRounds,
		turnsPerPrompt,
		systemPrompt: miniMode ? MINI_SYSTEM_PROMPT : undefined,
		execBase: process.env.EXEC_API_BASE,
		stoppedEarly,
		profileSwitchCount: prefixBrokenByScript,
		naturalProfileSwitches: profileEventCount,
		toolCallCounts: toolNameCounts,
		toolsetActivationCounts: toolsetNameCounts,
		total,
		requestCounts: { logical: totalCalls, assistant: totalAssistantCalls, http: totalHttpRequests, retries: totalRetries },
		groups: { transition: transitionStats, stable: stableStats },
		overallHitRate,
		rounds,
		requests: requestsAudit,
		// 完整会话快照：供 --resume 续跑（含消息历史 / 激活 profile / 工具集 / 扩展状态）
		snapshot: session.exportSnapshot(0),
	};
	const file = join(reportDir, `cache-realistic-${stamp}.json`);
	writeFileSync(file, JSON.stringify(report, null, 2));
	console.log(`报告已写入: ${file}`);

	if (mockServer) {
		await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
	}
}

void main();
