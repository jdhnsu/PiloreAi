import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createAssistantMessageEventStream,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	type MutableModels,
} from "@pilore/pi-ai";
import { createObservedStreamFn, type LlmTelemetryEvent } from "../../src/index.js";

test("telemetry 记录逻辑调用、每次 HTTP attempt、usage 与脱敏哈希", async () => {
	const provider = fauxProvider();
	const registry = createModels();
	registry.setProvider(provider.provider);
	const model = registry.getModel("faux", "faux-1")!;
	let fetchCalls = 0;
	const fakeFetch: typeof globalThis.fetch = async () => {
		fetchCalls += 1;
		return new Response("", { status: fetchCalls === 1 ? 503 : 200, headers: { "x-request-id": "provider-2" } });
	};
	const final = fauxAssistantMessage("done", { stopReason: "stop" });
	final.usage = {
		input: 10,
		output: 2,
		cacheRead: 90,
		cacheWrite: 0,
		totalTokens: 102,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const models = {
		streamSimple: async (_model: unknown, _context: unknown, options?: { fetch?: typeof globalThis.fetch }) => {
			await options!.fetch!("https://api.example.test/chat?secret=hidden", { method: "POST", body: "student secret" });
			await options!.fetch!("https://api.example.test/chat?secret=hidden", { method: "POST", body: "student secret" });
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: final }));
			return stream;
		},
	} as unknown as MutableModels;
	const events: LlmTelemetryEvent[] = [];
	const streamFn = createObservedStreamFn({
		models,
		fetch: fakeFetch,
		telemetry: { onEvent: (event) => events.push(event) },
		getProfileKey: () => "socrates",
	});
	const stream = await streamFn(model, {
		systemPrompt: "system secret",
		messages: [{ role: "user", content: "student secret", timestamp: 1 }],
		tools: [],
	});
	for await (const _event of stream) {
		// 消费到完成，触发 logical_request_end。
	}

	assert.equal(events.filter((event) => event.type === "logical_request_start").length, 1);
	assert.equal(events.filter((event) => event.type === "http_attempt_start").length, 2);
	assert.equal(events.filter((event) => event.type === "http_attempt_end").length, 2);
	const end = events.find((event) => event.type === "logical_request_end");
	assert.equal(end?.usage.cacheRead, 90);
	assert.equal(end?.successfulHttpRequestId, events.filter((event) => event.type === "http_attempt_start")[1]?.httpRequestId);
	const serialized = JSON.stringify(events);
	assert.doesNotMatch(serialized, /student secret|system secret|secret=hidden/);
	assert.match(serialized, /https:\/\/api\.example\.test\/chat/);
});

test("telemetry sink 抛错不会中断模型调用", async () => {
	const provider = fauxProvider();
	const models = createModels();
	models.setProvider(provider.provider);
	provider.setResponses([fauxAssistantMessage("ok", { stopReason: "stop" })]);
	const model = models.getModel("faux", "faux-1")!;
	const streamFn = createObservedStreamFn({
		models,
		telemetry: { onEvent: () => { throw new Error("observer failed"); } },
		getProfileKey: () => null,
	});
	const stream = await streamFn(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] });
	for await (const _event of stream) {
		// 必须正常结束。
	}
	assert.equal((await stream.result()).stopReason, "stop");
});
