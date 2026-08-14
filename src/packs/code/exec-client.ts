export interface ExecRequest { sandbox: string; command: string; files: Record<string, string> }
export interface ExecResponse { id: string; ok: boolean; duration: number; stdout: string; stderr: string }
export interface ExecClient { exec(request: ExecRequest): Promise<ExecResponse> }
export const DEFAULT_EXEC_API_BASE = "http://localhost:1313";
export function getExecApiBase(): string { return process.env.EXEC_API_BASE ?? DEFAULT_EXEC_API_BASE; }
export async function execCode(request: ExecRequest, baseUrl?: string): Promise<ExecResponse> { const base = (baseUrl ?? getExecApiBase()).replace(/\/+$/, ""); let response: Response; try { response = await fetch(`${base}/v1/exec`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(30_000) }); } catch (error) { throw new Error(`无法连接代码执行服务 ${base}: ${error instanceof Error ? error.message : String(error)}`); } if (!response.ok) throw new Error(`代码执行服务返回 HTTP ${response.status}: ${await response.text().catch(() => "")}`); return await response.json() as ExecResponse; }
export function createHttpExecClient(baseUrl?: string): ExecClient { return { exec: (request) => execCode(request, baseUrl) }; }
