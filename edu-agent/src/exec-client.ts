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

export const DEFAULT_EXEC_API_BASE = "http://192.168.172.134:1313";

export function getExecApiBase(): string {
	return process.env.EXEC_API_BASE ?? DEFAULT_EXEC_API_BASE;
}

export async function execCode(request: ExecRequest): Promise<ExecResponse> {
	const base = getExecApiBase().replace(/\/+$/, "");
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
			`无法连接代码执行服务 ${base}（请确认已启动: npm run mock，或配置 EXEC_API_BASE 指向真实后端）: ${err instanceof Error ? err.message : err}`,
		);
	}
	if (!res.ok) {
		throw new Error(`代码执行服务返回 HTTP ${res.status}: ${await res.text().catch(() => "")}`);
	}
	return (await res.json()) as ExecResponse;
}
