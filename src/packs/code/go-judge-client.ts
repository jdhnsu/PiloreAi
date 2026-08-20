import { randomUUID } from "node:crypto";

export const DEFAULT_GO_JUDGE_API_BASE = "http://127.0.0.1:5050";

export interface GoJudgeCompileSpec {
	args: string[];
	outputFile: string;
}

export interface GoJudgeLanguage {
	id: string;
	name: string;
	sourceFile: string;
	compile?: GoJudgeCompileSpec;
	runArgs: string[];
	env?: string[];
}

export const DEFAULT_GO_JUDGE_LANGUAGES: readonly GoJudgeLanguage[] = Object.freeze([
	{
		id: "c",
		name: "C (GCC)",
		sourceFile: "main.c",
		compile: { args: ["/usr/bin/gcc", "main.c", "-O2", "-std=c17", "-o", "main"], outputFile: "main" },
		runArgs: ["main"],
		env: ["PATH=/usr/bin:/bin", "LANG=C.UTF-8"],
	},
	{
		id: "cpp",
		name: "C++ (G++)",
		sourceFile: "main.cpp",
		compile: { args: ["/usr/bin/g++", "main.cpp", "-O2", "-std=c++20", "-o", "main"], outputFile: "main" },
		runArgs: ["main"],
		env: ["PATH=/usr/bin:/bin", "LANG=C.UTF-8"],
	},
	{
		id: "python",
		name: "Python 3",
		sourceFile: "main.py",
		runArgs: ["/usr/bin/python3", "main.py"],
		env: ["PATH=/usr/bin:/bin", "LANG=C.UTF-8", "PYTHONIOENCODING=utf-8"],
	},
]);

export interface GoJudgeExecutionInput {
	sourceCode: string;
	language: string;
	stdin?: string;
	arguments?: string[];
	compilerOptions?: string[];
	cpuTimeLimit?: number;
	wallTimeLimit?: number;
	memoryLimit?: number;
	outputLimit?: number;
}

export interface GoJudgeCaseInput {
	stdin: string;
}

export interface GoJudgePhaseResult {
	status: string;
	error: string | null;
	exitCode: number;
	timeSeconds: number;
	wallTimeSeconds: number;
	memoryKilobytes: number;
	processPeak: number | null;
	stdout: string;
	stderr: string;
}

export interface GoJudgeExecutionResult {
	id: string;
	language: GoJudgeLanguage;
	phase: "compile" | "run";
	status: string;
	sandboxStatus: string;
	stdout: string;
	stderr: string;
	compileOutput: string | null;
	error: string | null;
	timeSeconds: number;
	wallTimeSeconds: number;
	memoryKilobytes: number;
	exitCode: number;
	processPeak: number | null;
	compilation: GoJudgePhaseResult | null;
	cleanupError?: string;
}

export interface GoJudgeClient {
	listLanguages(): Promise<GoJudgeLanguage[]>;
	run(input: GoJudgeExecutionInput): Promise<GoJudgeExecutionResult>;
	runCases(input: Omit<GoJudgeExecutionInput, "stdin">, cases: readonly GoJudgeCaseInput[]): Promise<GoJudgeExecutionResult[]>;
}

export interface HttpGoJudgeClientOptions {
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
	headers?: Record<string, string>;
	requestTimeoutMs?: number;
	languages?: readonly GoJudgeLanguage[];
	concurrency?: number;
}

interface RawRecord {
	[key: string]: unknown;
}

interface RawGoJudgeResult {
	status: string;
	error?: string;
	exitStatus: number;
	time: number;
	memory: number;
	procPeak?: number;
	runTime: number;
	files?: Record<string, string>;
	fileIds?: Record<string, string>;
	fileError?: Array<{ name?: string; type?: string; message?: string }>;
}

interface PreparedFile {
	fileId: string;
}

interface MemoryFile {
	content: string;
}

const DEFAULT_CPU_LIMIT_SECONDS = 2;
const DEFAULT_WALL_LIMIT_SECONDS = 5;
const DEFAULT_MEMORY_LIMIT_KB = 128 * 1024;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MAX_CPU_LIMIT_SECONDS = 30;
const MAX_WALL_LIMIT_SECONDS = 60;
const MAX_MEMORY_LIMIT_KB = 1024 * 1024;
const MAX_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export function getGoJudgeApiBase(): string {
	return process.env.GO_JUDGE_API_BASE ?? DEFAULT_GO_JUDGE_API_BASE;
}

function cloneLanguage(language: GoJudgeLanguage): GoJudgeLanguage {
	return {
		...language,
		compile: language.compile ? { ...language.compile, args: [...language.compile.args] } : undefined,
		runArgs: [...language.runArgs],
		env: language.env ? [...language.env] : undefined,
	};
}

function requireRecord(value: unknown, context: string): RawRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} 返回了无效 JSON`);
	return value as RawRecord;
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`go-judge 返回的 ${field} 无效`);
	return value;
}

function normalizeRawResult(value: unknown): RawGoJudgeResult {
	const raw = requireRecord(value, "go-judge /run");
	if (typeof raw.status !== "string") throw new Error("go-judge 返回的 status 无效");
	const files = raw.files === undefined ? undefined : requireRecord(raw.files, "go-judge files") as Record<string, string>;
	const fileIds = raw.fileIds === undefined ? undefined : requireRecord(raw.fileIds, "go-judge fileIds") as Record<string, string>;
	return {
		status: raw.status,
		error: typeof raw.error === "string" ? raw.error : undefined,
		exitStatus: requireNumber(raw.exitStatus, "exitStatus"),
		time: requireNumber(raw.time, "time"),
		memory: requireNumber(raw.memory, "memory"),
		procPeak: typeof raw.procPeak === "number" ? raw.procPeak : undefined,
		runTime: requireNumber(raw.runTime, "runTime"),
		files,
		fileIds,
		fileError: Array.isArray(raw.fileError) ? raw.fileError as RawGoJudgeResult["fileError"] : undefined,
	};
}

function fileErrorMessage(result: RawGoJudgeResult): string | null {
	const messages = result.fileError?.map((item) => [item.name, item.type, item.message].filter(Boolean).join(": ")).filter(Boolean) ?? [];
	return [result.error, ...messages].filter(Boolean).join("\n") || null;
}

function toPhaseResult(result: RawGoJudgeResult): GoJudgePhaseResult {
	return {
		status: result.status,
		error: fileErrorMessage(result),
		exitCode: result.exitStatus,
		timeSeconds: result.time / 1_000_000_000,
		wallTimeSeconds: result.runTime / 1_000_000_000,
		memoryKilobytes: result.memory / 1024,
		processPeak: result.procPeak ?? null,
		stdout: result.files?.stdout ?? "",
		stderr: result.files?.stderr ?? "",
	};
}

function compileOutput(result: GoJudgePhaseResult): string | null {
	const parts = [
		result.stdout ? `stdout:\n${result.stdout}` : "",
		result.stderr ? `stderr:\n${result.stderr}` : "",
		result.error ? `error:\n${result.error}` : "",
	].filter(Boolean);
	return parts.length ? parts.join("\n") : null;
}

function validateLanguage(language: GoJudgeLanguage): void {
	if (!language.id || !language.name || !language.sourceFile || !language.runArgs.length) throw new Error("go-judge language 配置无效");
	if (language.compile && (!language.compile.args.length || !language.compile.outputFile)) throw new Error(`go-judge language ${language.id} 的编译配置无效`);
}

function validateInput(input: GoJudgeExecutionInput): void {
	if (!input.sourceCode) throw new Error("go-judge sourceCode 不能为空");
	if (!input.language) throw new Error("go-judge language 不能为空");
	for (const value of input.arguments ?? []) if (typeof value !== "string") throw new Error("arguments 必须是字符串数组");
	for (const value of input.compilerOptions ?? []) if (typeof value !== "string") throw new Error("compilerOptions 必须是字符串数组");
	const limits: Array<[string, number | undefined, number]> = [
		["cpuTimeLimit", input.cpuTimeLimit, MAX_CPU_LIMIT_SECONDS],
		["wallTimeLimit", input.wallTimeLimit, MAX_WALL_LIMIT_SECONDS],
		["memoryLimit", input.memoryLimit, MAX_MEMORY_LIMIT_KB],
		["outputLimit", input.outputLimit, MAX_OUTPUT_LIMIT_BYTES],
	];
	for (const [name, value, max] of limits) {
		if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > max)) throw new Error(`${name} 必须大于 0 且不超过 ${max}`);
	}
}

function limits(input: GoJudgeExecutionInput, compiling = false): RawRecord {
	if (compiling) {
		return {
			cpuLimit: 10_000_000_000,
			clockLimit: 20_000_000_000,
			memoryLimit: 512 * 1024 * 1024,
			procLimit: 50,
		};
	}
	const cpuSeconds = input.cpuTimeLimit ?? DEFAULT_CPU_LIMIT_SECONDS;
	const wallSeconds = input.wallTimeLimit ?? Math.max(DEFAULT_WALL_LIMIT_SECONDS, cpuSeconds * 2);
	return {
		cpuLimit: Math.round(cpuSeconds * 1_000_000_000),
		clockLimit: Math.round(wallSeconds * 1_000_000_000),
		memoryLimit: Math.round((input.memoryLimit ?? DEFAULT_MEMORY_LIMIT_KB) * 1024),
		procLimit: 32,
	};
}

function collectorFiles(stdin: string, outputLimit: number): RawRecord[] {
	return [
		{ content: stdin },
		{ name: "stdout", max: outputLimit },
		{ name: "stderr", max: outputLimit },
	];
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await run(items[index]!, index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

export function createHttpGoJudgeClient(options: HttpGoJudgeClientOptions = {}): GoJudgeClient {
	const baseUrl = (options.baseUrl ?? getGoJudgeApiBase()).replace(/\/+$/, "");
	const fetchFn = options.fetch ?? globalThis.fetch;
	const requestTimeoutMs = options.requestTimeoutMs ?? 65_000;
	const concurrency = options.concurrency ?? 4;
	const languages = (options.languages ?? DEFAULT_GO_JUDGE_LANGUAGES).map(cloneLanguage);
	for (const language of languages) validateLanguage(language);
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) throw new Error("go-judge concurrency 必须在 1–20 之间");

	async function request(path: string, init: RequestInit = {}): Promise<unknown> {
		const headers = new Headers(options.headers);
		for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
		headers.set("accept", "application/json");
		if (init.body !== undefined) headers.set("content-type", "application/json");
		let response: Response;
		try {
			response = await fetchFn(`${baseUrl}${path}`, {
				...init,
				headers,
				signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
			});
		} catch (error) {
			throw new Error(`无法连接 go-judge 服务 ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
		}
		const text = await response.text();
		let body: unknown = null;
		if (text) {
			try {
				body = JSON.parse(text);
			} catch {
				body = text;
			}
		}
		if (!response.ok) {
			const detail = typeof body === "string" ? body : JSON.stringify(body);
			throw new Error(`go-judge 返回 HTTP ${response.status}: ${detail.slice(0, 2_000)}`);
		}
		return body;
	}

	async function runCommand(command: RawRecord): Promise<RawGoJudgeResult> {
		const body = await request("/run", { method: "POST", body: JSON.stringify({ cmd: [command] }) });
		if (!Array.isArray(body) || body.length !== 1) throw new Error("go-judge /run 返回结果数量无效");
		return normalizeRawResult(body[0]);
	}

	async function deleteCachedFile(fileId: string): Promise<void> {
		await request(`/file/${encodeURIComponent(fileId)}`, { method: "DELETE" });
	}

	function languageFor(id: string): GoJudgeLanguage {
		const language = languages.find((item) => item.id === id);
		if (!language) throw new Error(`未知 go-judge language: ${id}`);
		return language;
	}

	async function executeCases(input: Omit<GoJudgeExecutionInput, "stdin">, cases: readonly GoJudgeCaseInput[]): Promise<GoJudgeExecutionResult[]> {
		validateInput(input);
		if (!cases.length || cases.length > 20) throw new Error("go-judge cases 数量必须在 1–20 之间");
		for (const item of cases) if (!item || typeof item.stdin !== "string") throw new Error("go-judge case.stdin 必须是字符串");
		const language = languageFor(input.language);
		const outputLimit = input.outputLimit ?? DEFAULT_OUTPUT_LIMIT_BYTES;
		let compilation: GoJudgePhaseResult | null = null;
		let cachedFileId: string | undefined;

		if (language.compile) {
			const rawCompilation = await runCommand({
				args: [...language.compile.args, ...(input.compilerOptions ?? [])],
				env: language.env,
				files: collectorFiles("", outputLimit),
				...limits(input, true),
				copyIn: { [language.sourceFile]: { content: input.sourceCode } as MemoryFile },
				copyOutCached: [language.compile.outputFile],
			});
			compilation = toPhaseResult(rawCompilation);
			cachedFileId = rawCompilation.fileIds?.[language.compile.outputFile];
			if (rawCompilation.status !== "Accepted" || !cachedFileId) {
				const status = rawCompilation.status === "Accepted" && !cachedFileId
					? "Internal Error"
					: rawCompilation.status === "Internal Error" || rawCompilation.status === "File Error"
						? rawCompilation.status
						: "Compilation Error";
				let cleanupError: string | undefined;
				if (cachedFileId) {
					try {
						await deleteCachedFile(cachedFileId);
					} catch (error) {
						cleanupError = error instanceof Error ? error.message : String(error);
					}
				}
				return cases.map(() => ({
					id: randomUUID(),
					language: cloneLanguage(language),
					phase: "compile",
					status,
					sandboxStatus: rawCompilation.status,
					stdout: "",
					stderr: compilation!.stderr,
					compileOutput: compileOutput(compilation!),
					error: compilation!.error ?? (!cachedFileId && rawCompilation.status === "Accepted" ? "编译成功但 go-judge 未返回缓存文件 ID" : null),
					timeSeconds: compilation!.timeSeconds,
					wallTimeSeconds: compilation!.wallTimeSeconds,
					memoryKilobytes: compilation!.memoryKilobytes,
					exitCode: compilation!.exitCode,
					processPeak: compilation!.processPeak,
					compilation,
					...(cleanupError ? { cleanupError } : {}),
				}));
			}
		}

		let results: GoJudgeExecutionResult[] = [];
		let cleanupError: string | undefined;
		try {
			results = await mapConcurrent(cases, concurrency, async (testCase) => {
				const copyIn: Record<string, PreparedFile | MemoryFile> = language.compile
					? { [language.compile.outputFile]: { fileId: cachedFileId! } }
					: { [language.sourceFile]: { content: input.sourceCode } };
				const raw = await runCommand({
					args: [...language.runArgs, ...(input.arguments ?? [])],
					env: language.env,
					files: collectorFiles(testCase.stdin, outputLimit),
					...limits(input),
					copyIn,
				});
				const phase = toPhaseResult(raw);
				return {
					id: randomUUID(),
					language: cloneLanguage(language),
					phase: "run" as const,
					status: raw.status,
					sandboxStatus: raw.status,
					stdout: phase.stdout,
					stderr: phase.stderr,
					compileOutput: compilation ? compileOutput(compilation) : null,
					error: phase.error,
					timeSeconds: phase.timeSeconds,
					wallTimeSeconds: phase.wallTimeSeconds,
					memoryKilobytes: phase.memoryKilobytes,
					exitCode: phase.exitCode,
					processPeak: phase.processPeak,
					compilation,
				};
			});
		} finally {
			if (cachedFileId) {
				try {
					await deleteCachedFile(cachedFileId);
				} catch (error) {
					cleanupError = error instanceof Error ? error.message : String(error);
				}
			}
		}
		if (cleanupError) results = results.map((result) => ({ ...result, cleanupError }));
		return results;
	}

	return {
		async listLanguages() {
			await request("/version");
			return languages.map(cloneLanguage);
		},
		async run(input) {
			const [result] = await executeCases(input, [{ stdin: input.stdin ?? "" }]);
			return result!;
		},
		runCases: executeCases,
	};
}
