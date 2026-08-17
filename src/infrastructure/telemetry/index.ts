import { createHash, randomUUID } from "node:crypto";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type FetchFunction,
	type Model,
	type MutableModels,
	type StopReason,
	type Usage,
} from "@pilore/pi-ai";
import type { StreamFn } from "@pilore/pi-agent-core";

interface PromptHashes {
	systemPromptHash: string;
	toolsHash: string;
	messageHashes: string[];
}

export type LlmTelemetryEvent =
	| ({
			type: "logical_request_start";
			logicalRequestId: string;
			callIndex: number;
			providerId: string;
			modelId: string;
			profileKey: string | null;
			commonPrefixMessages: number;
			timestamp: number;
		} & PromptHashes)
	| {
			type: "http_attempt_start";
			logicalRequestId: string;
			httpRequestId: string;
			attempt: number;
			method: string;
			endpoint: string;
			payloadHash: string;
			payloadBytes: number;
			timestamp: number;
		}
	| {
			type: "http_attempt_end";
			logicalRequestId: string;
			httpRequestId: string;
			attempt: number;
			status: number;
			durationMs: number;
			providerRequestId?: string;
			timestamp: number;
		}
	| {
			type: "http_attempt_error";
			logicalRequestId: string;
			httpRequestId: string;
			attempt: number;
			errorCode: string;
			durationMs: number;
			timestamp: number;
		}
	| {
			type: "logical_request_end";
			logicalRequestId: string;
			callIndex: number;
			stopReason: StopReason;
			usage: Usage;
			durationMs: number;
			successfulHttpRequestId?: string;
			timestamp: number;
		};

export interface LlmTelemetrySink {
	onEvent(event: LlmTelemetryEvent): void;
}

export interface ObservedStreamOptions {
	models: MutableModels;
	fetch?: FetchFunction;
	telemetry?: LlmTelemetrySink;
	getProfileKey(): string | null;
}

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, stableValue(item)]),
		);
	}
	return value;
}

function hash(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
	return hash(JSON.stringify(stableValue(value)));
}

function promptHashes(context: Context): PromptHashes {
	return {
		systemPromptHash: hash(context.systemPrompt ?? ""),
		toolsHash: hashJson(context.tools ?? []),
		messageHashes: context.messages.map(hashJson),
	};
}

function commonPrefixLength(previous: string[], current: string[]): number {
	const limit = Math.min(previous.length, current.length);
	let index = 0;
	while (index < limit && previous[index] === current[index]) index += 1;
	return index;
}

function emit(sink: LlmTelemetrySink | undefined, event: LlmTelemetryEvent): void {
	try {
		sink?.onEvent(event);
	} catch {
		// 观测不能影响教学请求。
	}
}

function sanitizeEndpoint(input: Parameters<FetchFunction>[0]): string {
	try {
		const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
		const url = new URL(raw);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "unknown";
	}
}

async function requestPayload(input: Parameters<FetchFunction>[0], init?: Parameters<FetchFunction>[1]): Promise<Uint8Array> {
	const body = init?.body;
	if (typeof body === "string") return new TextEncoder().encode(body);
	if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
	if (typeof Request !== "undefined" && input instanceof Request) {
		try {
			return new Uint8Array(await input.clone().arrayBuffer());
		} catch {
			return new Uint8Array();
		}
	}
	return body == null ? new Uint8Array() : new TextEncoder().encode(Object.prototype.toString.call(body));
}

function providerRequestId(response: Response): string | undefined {
	for (const name of ["x-request-id", "request-id", "x-amzn-requestid", "cf-ray"]) {
		const value = response.headers.get(name);
		if (value) return value;
	}
	return undefined;
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
	return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function failedMessage(model: Model<string>, cause: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: "error",
		errorMessage: cause instanceof Error ? cause.message : String(cause),
		timestamp: Date.now(),
	};
}

/** 为每个 Agent 实例建立请求序号、前缀指纹和 HTTP attempt 观测。 */
export function createObservedStreamFn(options: ObservedStreamOptions): StreamFn {
	let callIndex = 0;
	let previousMessageHashes: string[] = [];
	return async (model, context, streamOptions) => {
		const telemetry = options.telemetry;
		if (!telemetry) {
			return options.models.streamSimple(model, context, options.fetch ? { ...streamOptions, fetch: options.fetch } : streamOptions);
		}

		const logicalRequestId = randomUUID();
		const currentCallIndex = ++callIndex;
		const startedAt = Date.now();
		const hashes = promptHashes(context);
		emit(telemetry, {
			type: "logical_request_start",
			logicalRequestId,
			callIndex: currentCallIndex,
			providerId: model.provider,
			modelId: model.id,
			profileKey: options.getProfileKey(),
			...hashes,
			commonPrefixMessages: commonPrefixLength(previousMessageHashes, hashes.messageHashes),
			timestamp: startedAt,
		});
		previousMessageHashes = hashes.messageHashes;

		let attempt = 0;
		let successfulHttpRequestId: string | undefined;
		const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		const observedFetch: FetchFunction = async (input, init) => {
			const currentAttempt = ++attempt;
			const httpRequestId = randomUUID();
			const attemptStartedAt = Date.now();
			const payload = await requestPayload(input, init);
			emit(telemetry, {
				type: "http_attempt_start",
				logicalRequestId,
				httpRequestId,
				attempt: currentAttempt,
				method: init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"),
				endpoint: sanitizeEndpoint(input),
				payloadHash: hash(payload),
				payloadBytes: payload.byteLength,
				timestamp: attemptStartedAt,
			});
			try {
				const response = await baseFetch(input, init);
				if (response.ok) successfulHttpRequestId = httpRequestId;
				emit(telemetry, {
					type: "http_attempt_end",
					logicalRequestId,
					httpRequestId,
					attempt: currentAttempt,
					status: response.status,
					durationMs: Date.now() - attemptStartedAt,
					...(providerRequestId(response) ? { providerRequestId: providerRequestId(response) } : {}),
					timestamp: Date.now(),
				});
				return response;
			} catch (cause) {
				emit(telemetry, {
					type: "http_attempt_error",
					logicalRequestId,
					httpRequestId,
					attempt: currentAttempt,
					errorCode: errorCode(cause),
					durationMs: Date.now() - attemptStartedAt,
					timestamp: Date.now(),
				});
				throw cause;
			}
		};

		let source;
		try {
			source = await options.models.streamSimple(model, context, { ...streamOptions, fetch: observedFetch });
		} catch (cause) {
			emit(telemetry, {
				type: "logical_request_end",
				logicalRequestId,
				callIndex: currentCallIndex,
				stopReason: "error",
				usage: EMPTY_USAGE,
				durationMs: Date.now() - startedAt,
				...(successfulHttpRequestId ? { successfulHttpRequestId } : {}),
				timestamp: Date.now(),
			});
			throw cause;
		}

		if (!telemetry) return source;
		const observed = createAssistantMessageEventStream();
		void (async () => {
			try {
				for await (const event of source) {
					if (event.type === "done" || event.type === "error") {
						const final = event.type === "done" ? event.message : event.error;
						emit(telemetry, {
							type: "logical_request_end",
							logicalRequestId,
							callIndex: currentCallIndex,
							stopReason: final.stopReason,
							usage: final.usage,
							durationMs: Date.now() - startedAt,
							...(successfulHttpRequestId ? { successfulHttpRequestId } : {}),
							timestamp: Date.now(),
						});
					}
					observed.push(event);
				}
			} catch (cause) {
				const failure = failedMessage(model, cause);
				emit(telemetry, {
					type: "logical_request_end",
					logicalRequestId,
					callIndex: currentCallIndex,
					stopReason: "error",
					usage: EMPTY_USAGE,
					durationMs: Date.now() - startedAt,
					...(successfulHttpRequestId ? { successfulHttpRequestId } : {}),
					timestamp: Date.now(),
				});
				observed.push({ type: "error", reason: "error", error: failure });
			}
		})();
		return observed;
	};
}
