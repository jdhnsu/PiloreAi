import type { ToolPack } from "../../core/types.js";
import type { ExecClient } from "../../exec-client.js";
import type { VirtualFS } from "../../vfs.js";

/** Optional evaluation seam for code products; default Code Pack does not score learner code. */
export interface CodeEvaluator { evaluate(input: { files: Record<string, string>; entry?: string }): Promise<unknown> | unknown }
export interface CodeDomainPack extends ToolPack { id: "code"; vfs: VirtualFS; exec: ExecClient; evaluator?: CodeEvaluator }
