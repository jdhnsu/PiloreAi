import type { ToolPack } from "../../core/types.js";
import type { ExecClient } from "../../exec-client.js";
import { createCodeTools } from "./tools.js";
import type { VirtualFS } from "../../vfs.js";
import type { CodeDomainPack, CodeEvaluator } from "./types.js";

/** Creates the Code capability pack (VFS + injected execution client + code tools). */
export function createCodeDomainPack(options: { vfs: VirtualFS; exec: ExecClient; evaluator?: CodeEvaluator }): CodeDomainPack {
	return { id: "code", vfs: options.vfs, exec: options.exec, evaluator: options.evaluator, tools: createCodeTools(options.vfs, options.exec) };
}

/** Alias for consumers that only need its tools. */
export function createCodeToolPack(options: Parameters<typeof createCodeDomainPack>[0]): ToolPack {
	return createCodeDomainPack(options);
}
