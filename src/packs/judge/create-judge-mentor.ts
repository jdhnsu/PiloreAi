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
import { buildJudgeMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultJudgeProfiles } from "./agent-design/profiles.js";
import { createHttpGoJudgeClient, type GoJudgeClient, type GoJudgeExecutionInput, type GoJudgeExecutionResult, type GoJudgeLanguage } from "./go-judge-client.js";
import { createJudgeService, type JudgeService } from "./judge-service.js";
import { createJudgeRouterConfig } from "./router-config.js";
import { createJudgeSnapshotExtension } from "./snapshot-extension.js";
import { createJudgeMentorState, publicProblem, type JudgeMentorState, type JudgeProblemCard, type JudgeSubmission } from "./state.js";
import { createJudgeToolManifest } from "./tools/manifest.js";

export interface JudgeMentorConfig {
	models?: MutableModels;
	model?: Model<string>;
	customModel?: CustomModelConfig;
	useEnvCustomModel?: boolean;
	providerId?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	profiles?: ProfileDefinition[];
	goJudge?: GoJudgeClient;
	goJudgeBaseUrl?: string;
	snapshot?: SessionSnapshot;
	maxTurns?: number;
	contextPolicy?: ContextPolicy;
	fetch?: typeof globalThis.fetch;
	llmTelemetry?: LlmTelemetrySink;
}

interface ResolvedJudgeMentor {
	profiles: ProfileDefinition[];
	state: JudgeMentorState;
	service: JudgeService;
	models: MutableModels;
	model: Model<string>;
	domain: DomainPack;
}

function resolveJudgeMentor(config: JudgeMentorConfig): ResolvedJudgeMentor {
	const profiles = config.profiles ?? getDefaultJudgeProfiles();
	const state = createJudgeMentorState();
	const client = config.goJudge ?? createHttpGoJudgeClient({ baseUrl: config.goJudgeBaseUrl, fetch: config.fetch });
	const service = createJudgeService(state, client);
	const manifest = createJudgeToolManifest(service);
	const router = createJudgeRouterConfig(profiles, state);
	const extension = createJudgeSnapshotExtension(state, profiles.map((profile) => profile.key));
	const customModel = config.customModel ?? (config.useEnvCustomModel === false ? undefined : resolveCustomModelConfig());
	const models = config.models ?? createModelCollection();
	const customProviderId = customModel ? registerCustomModel(models, customModel) : undefined;
	const providerId = customProviderId ?? config.providerId ?? resolveProviderId();
	const modelId = customModel?.id ?? config.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	const model = config.model ?? models.getModel(providerId, modelId);
	if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`);
	return {
		profiles,
		state,
		service,
		models,
		model,
		domain: {
			id: "judge",
			basePrompt: config.systemPrompt ?? buildJudgeMentorPrompt(profiles, manifest),
			router,
			toolManifest: manifest,
			snapshotExtension: extension,
		},
	};
}

export interface JudgeMentor {
	runtime: Runtime;
	state: JudgeMentorState;
	service: JudgeService;
	profiles: ProfileDefinition[];
	model: Model<string>;
}

export function createJudgeMentor(config: JudgeMentorConfig = {}): JudgeMentor {
	const resolved = resolveJudgeMentor(config);
	const runtime = createRuntime({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return { runtime, state: resolved.state, service: resolved.service, profiles: resolved.profiles, model: resolved.model };
}

export interface JudgeMentorSession extends Session {
	getProblem(): JudgeProblemCard | null;
	getLastSubmission(): JudgeSubmission | null;
	listJudgeLanguages(): Promise<GoJudgeLanguage[]>;
	runJudgeCode(input: GoJudgeExecutionInput): Promise<GoJudgeExecutionResult>;
	submitJudgeSolution(sourceCode: string, language: string): Promise<JudgeSubmission>;
	readonly modelInfo: string;
	readonly judgeState: JudgeMentorState;
}

export function createJudgeMentorSession(config: JudgeMentorConfig = {}): JudgeMentorSession {
	const resolved = resolveJudgeMentor(config);
	const session = createSession({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return Object.assign(session, {
		getProblem: () => publicProblem(resolved.state.currentProblem),
		getLastSubmission: () => resolved.service.getLastSubmission(),
		listJudgeLanguages: () => resolved.service.listLanguages(),
		runJudgeCode: (input: GoJudgeExecutionInput) => resolved.service.runCode(input),
		submitJudgeSolution: (sourceCode: string, language: string) => resolved.service.submitSolution(sourceCode, language),
		modelInfo: `${resolved.model.provider}/${resolved.model.id}`,
		judgeState: resolved.state,
	});
}
