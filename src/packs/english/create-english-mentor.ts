import type { ThinkingLevel } from "@pilore/pi-agent-core";
import type { Model, MutableModels } from "@pilore/pi-ai";
import { createRuntime, type Runtime } from "../../core/runtime/index.js";
import { createSession, type Session } from "../../core/session/index.js";
import type { ContextPolicy, DomainPack, ProfileDefinition, SessionSnapshot } from "../../core/types.js";
import {
	createModelCollection,
	DEFAULT_MODEL_IDS,
	registerCustomModel,
	resolveCustomModelConfig,
	resolveProviderId,
	type CustomModelConfig,
} from "../../infrastructure/models/index.js";
import type { LlmTelemetrySink } from "../../infrastructure/telemetry/index.js";
import { buildEnglishMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultEnglishProfiles } from "./agent-design/profiles.js";
import type { EnglishEvaluator } from "./evaluator.js";
import { createEnglishRouterConfig } from "./router-config.js";
import { createEnglishSnapshotExtension } from "./snapshot-extension.js";
import { createEnglishMentorState, type EnglishMentorState } from "./state.js";
import { createEnglishToolManifest } from "./tools/manifest.js";
import { VocabBank, type WordEntry } from "./vocab.js";

export interface EnglishMentorConfig {
	models?: MutableModels;
	model?: Model<string>;
	customModel?: CustomModelConfig;
	useEnvCustomModel?: boolean;
	providerId?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	profiles?: ProfileDefinition[];
	vocab?: VocabBank;
	evaluator?: EnglishEvaluator;
	snapshot?: SessionSnapshot;
	maxTurns?: number;
	contextPolicy?: ContextPolicy;
	fetch?: typeof globalThis.fetch;
	llmTelemetry?: LlmTelemetrySink;
}

interface ResolvedEnglishMentor {
	profiles: ProfileDefinition[];
	vocab: VocabBank;
	state: EnglishMentorState;
	models: MutableModels;
	model: Model<string>;
	domain: DomainPack;
}

function resolveEnglishMentor(config: EnglishMentorConfig): ResolvedEnglishMentor {
	const profiles = config.profiles ?? getDefaultEnglishProfiles();
	const vocab = config.vocab ?? new VocabBank();
	const state = createEnglishMentorState();
	const manifest = createEnglishToolManifest(vocab, state, config.evaluator);
	const router = createEnglishRouterConfig(profiles, state);
	const extension = createEnglishSnapshotExtension(state, vocab, profiles.map((profile) => profile.key));
	const customModel = config.customModel ?? (config.useEnvCustomModel === false ? undefined : resolveCustomModelConfig());
	const models = config.models ?? createModelCollection();
	const customProviderId = customModel ? registerCustomModel(models, customModel) : undefined;
	const providerId = customProviderId ?? config.providerId ?? resolveProviderId();
	const modelId = customModel?.id ?? config.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	const model = config.model ?? models.getModel(providerId, modelId);
	if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`);

	return {
		profiles,
		vocab,
		state,
		models,
		model,
		domain: {
			id: "english",
			basePrompt: config.systemPrompt ?? buildEnglishMentorPrompt(profiles, manifest),
			router,
			toolManifest: manifest,
			snapshotExtension: extension,
		},
	};
}

export interface EnglishMentor {
	runtime: Runtime;
	vocab: VocabBank;
	state: EnglishMentorState;
	profiles: ProfileDefinition[];
	model: Model<string>;
}

export function createEnglishMentor(config: EnglishMentorConfig = {}): EnglishMentor {
	const resolved = resolveEnglishMentor(config);
	const runtime = createRuntime({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return { runtime, vocab: resolved.vocab, state: resolved.state, profiles: resolved.profiles, model: resolved.model };
}

export interface EnglishMentorSession extends Session {
	listWords(): WordEntry[];
	getWord(word: string): WordEntry | undefined;
	readonly modelInfo: string;
	readonly englishState: EnglishMentorState;
}

export function createEnglishMentorSession(config: EnglishMentorConfig = {}): EnglishMentorSession {
	const resolved = resolveEnglishMentor(config);
	const session = createSession({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return Object.assign(session, {
		listWords: () => resolved.vocab.list(),
		getWord: (word: string) => resolved.vocab.get(word),
		modelInfo: `${resolved.model.provider}/${resolved.model.id}`,
		englishState: resolved.state,
	});
}
