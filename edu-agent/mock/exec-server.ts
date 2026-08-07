import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * mock 代码执行服务（codapi 风格）。不真正执行代码，按简单规则模拟输出：
 * 1. 提取所有 print("字面量") 的参数拼接为 stdout
 * 2. 有 print 但参数不是字符串字面量 → 返回模拟说明
 * 3. 否则固定返回 hello
 */

interface ExecBody {
	sandbox?: string;
	command?: string;
	files?: Record<string, string>;
}

const PRINT_CALL_RE = /\bprint\s*\(/g;
const PRINT_LITERAL_RE = /\bprint\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g;

export function simulate(files: Record<string, string>): { stdout: string; stderr: string } {
	const literals: string[] = [];
	let printCount = 0;
	for (const content of Object.values(files)) {
		printCount += content.match(PRINT_CALL_RE)?.length ?? 0;
		for (const match of content.matchAll(PRINT_LITERAL_RE)) literals.push(match[2]);
	}
	if (literals.length > 0) return { stdout: literals.join("\n"), stderr: "" };
	if (printCount > 0) {
		return {
			stdout: `[mock] 检测到 ${printCount} 处 print(...)，参数不是字符串字面量，mock 无法求值。接入真实沙箱后端后可见真实输出。`,
			stderr: "",
		};
	}
	return { stdout: "hello", stderr: "" };
}

export function createMockExecServer(): http.Server {
	return http.createServer((req, res) => {
		if (req.method === "GET" && req.url === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, mock: true }));
			return;
		}
		if (req.method === "POST" && req.url === "/v1/exec") {
			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += chunk;
				if (body.length > 5_000_000) req.destroy();
			});
			req.on("end", () => {
				try {
					const parsed = JSON.parse(body) as ExecBody;
					if (!parsed.sandbox || typeof parsed.sandbox !== "string") {
						throw new Error("请求缺少 sandbox 字段");
					}
					const { stdout, stderr } = simulate(parsed.files ?? {});
					const payload = {
						id: `mock:${Date.now()}`,
						ok: true,
						duration: 100 + Math.floor(Math.random() * 200),
						stdout,
						stderr,
					};
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(payload));
				} catch (err) {
					res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
				}
			});
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "not found" }));
	});
}

// 直接运行时监听端口；被 import 时无副作用（demo 会复用 createMockExecServer）
const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
	const port = Number(process.env.PORT ?? 1313);
	const server = createMockExecServer();
	server.listen(port, () => {
		console.log(`[mock-exec] 监听 http://localhost:${port}（POST /v1/exec，GET /health）`);
	});
}
