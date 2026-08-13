import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, MutableModels } from "@earendil-works/pi-ai";
import { createRuntime, type Runtime } from "../../../core/runtime/index.js";
import { createSession, type Session } from "../../../core/session/index.js";
import type { DomainPack, ProfileDefinition, SessionSnapshot, ToolManifest } from "../../../core/types.js";
import {
	createModelCollection,
	DEFAULT_MODEL_IDS,
	registerCustomModel,
	resolveCustomModelConfig,
	resolveProviderId,
	type CustomModelConfig,
} from "../../../infrastructure/models/index.js";
import type { LlmTelemetrySink } from "../../../infrastructure/telemetry/index.js";
import type { AcademicEvaluator } from "./evaluator.js";
import { createAcademicRouterConfig } from "./router-config.js";
import { createAcademicSnapshotExtension } from "./snapshot-extension.js";
import { createAcademicMentorState, type AcademicMentorState } from "./state.js";
import { StudyCardBank, type StudyCard } from "./study-card-bank.js";
import { createAcademicToolManifest, type AcademicToolSpec } from "./tools.js";

export interface AcademicPackSpec<TSubject extends string> {
	id: TSubject;
	subjectName: string;
	getDefaultProfiles(): ProfileDefinition[];
	buildPrompt(profiles: ProfileDefinition[], manifest: ToolManifest): string;
	tools: Omit<AcademicToolSpec<TSubject>, "subjectId" | "subjectName">;
}

export interface AcademicMentorConfig<TSubject extends string = string> {
	models?: MutableModels;
	model?: Model<string>;
	customModel?: CustomModelConfig;
	useEnvCustomModel?: boolean;
	providerId?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	profiles?: ProfileDefinition[];
	cards?: StudyCardBank;
	evaluator?: AcademicEvaluator<TSubject>;
	snapshot?: SessionSnapshot;
	maxTurns?: number;
	fetch?: typeof globalThis.fetch;
	llmTelemetry?: LlmTelemetrySink;
}

interface ResolvedAcademicMentor {
	profiles: ProfileDefinition[];
	cards: StudyCardBank;
	state: AcademicMentorState;
	models: MutableModels;
	model: Model<string>;
	domain: DomainPack;
}

function resolveAcademicMentor<TSubject extends string>(
	config: AcademicMentorConfig<TSubject>,
	spec: AcademicPackSpec<TSubject>,
): ResolvedAcademicMentor {
	const profiles = config.profiles ?? spec.getDefaultProfiles();
	const cards = config.cards ?? new StudyCardBank();
	const state = createAcademicMentorState();
	const toolSpec: AcademicToolSpec<TSubject> = {
		subjectId: spec.id,
		subjectName: spec.subjectName,
		cardKinds: spec.tools.cardKinds,
		practiceTypes: spec.tools.practiceTypes,
	};
	const manifest = createAcademicToolManifest(cards, state, toolSpec, config.evaluator);
	const router = createAcademicRouterConfig(profiles, state, spec.subjectName);
	const extension = createAcademicSnapshotExtension(
		spec.id,
		state,
		cards,
		profiles.map((profile) => profile.key),
		spec.tools.cardKinds,
	);
	const customModel = config.customModel ?? (config.useEnvCustomModel === false ? undefined : resolveCustomModelConfig());
	const models = config.models ?? createModelCollection();
	const customProviderId = customModel ? registerCustomModel(models, customModel) : undefined;
	const providerId = customProviderId ?? config.providerId ?? resolveProviderId();
	const modelId = customModel?.id ?? config.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId];
	const model = config.model ?? models.getModel(providerId, modelId);
	if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`);
	return {
		profiles,
		cards,
		state,
		models,
		model,
		domain: {
			id: spec.id,
			basePrompt: config.systemPrompt ?? spec.buildPrompt(profiles, manifest),
			router,
			toolManifest: manifest,
			snapshotExtension: extension,
		},
	};
}

export interface AcademicMentor {
	runtime: Runtime;
	cards: StudyCardBank;
	state: AcademicMentorState;
	profiles: ProfileDefinition[];
	model: Model<string>;
}

export function createAcademicMentor<TSubject extends string>(
	config: AcademicMentorConfig<TSubject>,
	spec: AcademicPackSpec<TSubject>,
): AcademicMentor {
	const resolved = resolveAcademicMentor(config, spec);
	const runtime = createRuntime({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return { runtime, cards: resolved.cards, state: resolved.state, profiles: resolved.profiles, model: resolved.model };
}

export interface AcademicMentorSession extends Session {
	listCards(): StudyCard[];
	getCard(id: string): StudyCard | undefined;
	readonly modelInfo: string;
	readonly academicState: AcademicMentorState;
}

export function createAcademicMentorSession<TSubject extends string>(
	config: AcademicMentorConfig<TSubject>,
	spec: AcademicPackSpec<TSubject>,
): AcademicMentorSession {
	const resolved = resolveAcademicMentor(config, spec);
	const session = createSession({ ...config, model: resolved.model, models: resolved.models, domain: resolved.domain });
	return Object.assign(session, {
		listCards: () => resolved.cards.list(),
		getCard: (id: string) => {
			try {
				return resolved.cards.get(id);
			} catch {
				return undefined;
			}
		},
		modelInfo: `${resolved.model.provider}/${resolved.model.id}`,
		academicState: resolved.state,
	});
}
