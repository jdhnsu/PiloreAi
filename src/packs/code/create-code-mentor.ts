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
import { buildCodeMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultCodeProfiles } from "./agent-design/profiles.js";
import type { CodeEvaluator } from "./evaluator.js";
import { createHttpExecClient, type ExecClient } from "./exec-client.js";
import { createCodeRouterConfig } from "./router-config.js";
import { createCodeSnapshotExtension } from "./snapshot-extension.js";
import { createCodeMentorState, type CodeMentorState } from "./state.js";
import { createCodeToolManifest } from "./tools/manifest.js";
import { VirtualFS } from "./vfs.js";

export interface CodeMentorConfig {
	models?: MutableModels;
	model?: Model<string>;
	customModel?: CustomModelConfig;
	useEnvCustomModel?: boolean;
	providerId?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	profiles?: ProfileDefinition[];
	vfs?: VirtualFS;
	exec?: ExecClient;
	evaluator?: CodeEvaluator;
	snapshot?: SessionSnapshot;
	maxTurns?: number;
	contextPolicy?: ContextPolicy;
	fetch?: typeof globalThis.fetch;
	llmTelemetry?: LlmTelemetrySink;
}

interface ResolvedCodeMentor {
	profiles: ProfileDefinition[];
	vfs: VirtualFS;
	state: CodeMentorState;
	models: MutableModels;
	model: Model<string>;
	domain: DomainPack;
}

function resolveCodeMentor(config: CodeMentorConfig): ResolvedCodeMentor {
	const profiles = config.profiles ?? getDefaultCodeProfiles();
	const vfs = config.vfs ?? new VirtualFS();
	const state = createCodeMentorState();
	const manifest = createCodeToolManifest(vfs, config.exec ?? createHttpExecClient(), config.evaluator);
	const router = createCodeRouterConfig(profiles, state);
	const extension = createCodeSnapshotExtension(state, vfs, profiles.map((profile) => profile.key));
	const customModel = config.customModel ?? (config.useEnvCustomModel === false ? undefined : resolveCustomModelConfig());
	const models = config.models ?? createModelCollection();
	const customProviderId = customModel ? registerCustomModel(models, customModel) : undefined;
	const providerId = customProviderId ?? config.providerId ?? resolveProviderId();
	const modelId = customModel?.id ?? config.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	const model = config.model ?? models.getModel(providerId, modelId);
	if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`);

	return {
		profiles,
		vfs,
		state,
		models,
		model,
		domain: {
			id: "code",
			basePrompt: config.systemPrompt ?? buildCodeMentorPrompt(profiles, manifest),
			router,
			toolManifest: manifest,
			snapshotExtension: extension,
		},
	};
}

export interface CodeMentor {
	runtime: Runtime;
	vfs: VirtualFS;
	state: CodeMentorState;
	profiles: ProfileDefinition[];
	model: Model<string>;
}

export function createCodeMentor(config: CodeMentorConfig = {}): CodeMentor {
	const resolved = resolveCodeMentor(config);
	const runtime = createRuntime({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return { runtime, vfs: resolved.vfs, state: resolved.state, profiles: resolved.profiles, model: resolved.model };
}

export interface CodeMentorSession extends Session {
	listFiles(): string[];
	readFile(path: string): string | undefined;
	readonly modelInfo: string;
	readonly codeState: CodeMentorState;
}

export function createCodeMentorSession(config: CodeMentorConfig = {}): CodeMentorSession {
	const resolved = resolveCodeMentor(config);
	const session = createSession({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return Object.assign(session, {
		listFiles: () => resolved.vfs.list(),
		readFile: (path: string) => {
			try {
				return resolved.vfs.read(path);
			} catch {
				return undefined;
			}
		},
		modelInfo: `${resolved.model.provider}/${resolved.model.id}`,
		codeState: resolved.state,
	});
}
