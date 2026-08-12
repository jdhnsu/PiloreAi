import type { Model, MutableModels } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createSession, type Session } from "../../core/session/index.js";
import { createRuntime, type Runtime } from "../../core/runtime/index.js";
import type { SessionSnapshot } from "../../core/types.js";
import { createModelCollection, DEFAULT_MODEL_IDS, registerCustomModel, resolveCustomModelConfig, resolveProviderId, type CustomModelConfig } from "../../models/index.js";
import type { LlmTelemetrySink } from "../../telemetry.js";
import { buildEnglishMentorPrompt } from "./agent-design/base-prompt.js";
import { getDefaultEnglishProfiles } from "./agent-design/profiles.js";
import { createEnglishRouterConfig } from "./router-config.js";
import { createEnglishMentorState, type EnglishMentorState } from "./state.js";
import { createEnglishSnapshotExtension } from "./snapshot-extension.js";
import { createEnglishToolManifest } from "./tools/manifest.js";
import { VocabBank, type WordEntry } from "./vocab.js";
import type { EnglishEvaluator } from "./evaluator.js";
import type { ProfileDefinition } from "../../core/types.js";
export interface EnglishMentorConfig { models?: MutableModels; model?: Model<string>; customModel?: CustomModelConfig; useEnvCustomModel?: boolean; providerId?: string; modelId?: string; thinkingLevel?: ThinkingLevel; systemPrompt?: string; profiles?: ProfileDefinition[]; vocab?: VocabBank; evaluator?: EnglishEvaluator; snapshot?: SessionSnapshot; maxTurns?: number; fetch?: typeof globalThis.fetch; llmTelemetry?: LlmTelemetrySink }
function resolve(config: EnglishMentorConfig) { const profiles = config.profiles ?? getDefaultEnglishProfiles(); const vocab = config.vocab ?? new VocabBank(); const englishState = createEnglishMentorState(); const manifest = createEnglishToolManifest(vocab, englishState, config.evaluator); const router = createEnglishRouterConfig(profiles, englishState); const extension = createEnglishSnapshotExtension(englishState, vocab, profiles.map((p) => p.key)); const custom = config.customModel ?? (config.useEnvCustomModel === false ? undefined : resolveCustomModelConfig()); const models = config.models ?? createModelCollection(); const customProvider = custom ? registerCustomModel(models, custom) : undefined; const providerId = customProvider ?? config.providerId ?? resolveProviderId(); const modelId = custom?.id ?? config.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_IDS[providerId]; const model = config.model ?? models.getModel(providerId, modelId); if (!model) throw new Error(`找不到模型 ${providerId}/${modelId}`); return { profiles, vocab, englishState, models, model, domain: { id: "english", basePrompt: config.systemPrompt ?? buildEnglishMentorPrompt(profiles, manifest), router, toolManifest: manifest, snapshotExtension: extension } }; }
export interface EnglishMentor { runtime: Runtime; vocab: VocabBank; state: EnglishMentorState; profiles: ProfileDefinition[]; model: Model<string> }
export function createEnglishMentor(config: EnglishMentorConfig = {}): EnglishMentor { const built = resolve(config); const runtime = createRuntime({ ...config, model: built.model, models: built.models, domain: built.domain }); return { runtime, vocab: built.vocab, state: built.englishState, profiles: built.profiles, model: built.model }; }
export interface EnglishMentorSession extends Session { listWords(): WordEntry[]; getWord(word: string): WordEntry | undefined; readonly modelInfo: string; readonly englishState: EnglishMentorState }
export function createEnglishMentorSession(config: EnglishMentorConfig = {}): EnglishMentorSession { const built = resolve(config); const session = createSession({ ...config, model: built.model, models: built.models, domain: built.domain, snapshot: config.snapshot }); return Object.assign(session, { listWords: () => built.vocab.list(), getWord: (word: string) => built.vocab.get(word), modelInfo: `${built.model.provider}/${built.model.id}`, englishState: built.englishState }); }
