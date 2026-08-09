// 在线赛事/离线共用的执行后端:启动单实例 mock exec 并设置 EXEC_API_BASE。
// 启动一次供整个测试过程复用,保证每个用例的 run_code 都是确定性的。
import type { AddressInfo } from "node:net";
import { createMockExecServer } from "../../mock/exec-server.js";

export interface MockExecHandle {
	/** 已注入 process.env.EXEC_API_BASE 的 base URL(不以 / 结尾) */
	baseUrl: string;
	/** 关闭 HTTP server(可在套件结束时调用) */
	close(): Promise<void>;
}

let singleton: MockExecHandle | undefined;

/** 启动(或复用)进程内 mock 执行服务并注入环境变量。幂等。 */
export async function ensureMockExec(): Promise<MockExecHandle> {
	if (singleton) return singleton;
	const server = createMockExecServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	process.env.EXEC_API_BASE = baseUrl;
	singleton = {
		baseUrl,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => {
					singleton = undefined;
					resolve();
				});
			}),
	};
	return singleton;
}

/** 关闭共享 mock(供运行末尾释放事件循环)。 */
export async function closeMockExec(): Promise<void> {
	await singleton?.close();
}