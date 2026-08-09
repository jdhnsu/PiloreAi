/** codapi 风格代码执行后端的 HTTP 客户端。 */

export interface ExecRequest {
	sandbox: string;
	command: string;
	files: Record<string, string>;
}

export interface ExecResponse {
	id: string;
	ok: boolean;
	duration: number;
	stdout: string;
	stderr: string;
}

/**
 * 执行后端边界接口：run_code 工具把整个 VFS 文件交给执行器，返回 stdout/stderr。
 * 嵌入其它项目时实现本接口即可替换执行后端（进程内沙箱 / HTTP / 子进程均可），
 * 缺省实现为 `createHttpExecClient()`（codapi 风格 POST /v1/exec）。
 */
export interface ExecClient {
	exec(request: ExecRequest): Promise<ExecResponse>;
}

export const DEFAULT_EXEC_API_BASE = "http://192.168.172.134:1313";

export function getExecApiBase(): string {
	return process.env.EXEC_API_BASE ?? DEFAULT_EXEC_API_BASE;
}

export async function execCode(request: ExecRequest, baseUrl?: string): Promise<ExecResponse> {
	const base = (baseUrl ?? getExecApiBase()).replace(/\/+$/, "");
	let res: Response;
	try {
		res = await fetch(`${base}/v1/exec`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (err) {
		throw new Error(
			`无法连接代码执行服务 ${base}（请确认已启动: npm run mock，或配置 EXEC_API_BASE 指向真实后端）: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!res.ok) {
		throw new Error(`代码执行服务返回 HTTP ${res.status}: ${await res.text().catch(() => "")}`);
	}
	return (await res.json()) as ExecResponse;
}

/**
 * 构造默认 HTTP 执行后端。`baseUrl` 省略时在每次调用读取 `EXEC_API_BASE`
 * 环境变量（缺省 DEFAULT_EXEC_API_BASE），便于测试/演示动态切换。
 */
export function createHttpExecClient(baseUrl?: string): ExecClient {
	return { exec: (request) => execCode(request, baseUrl) };
}
