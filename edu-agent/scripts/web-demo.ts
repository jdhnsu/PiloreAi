// 演示模式入口：无需 API key（fauxProvider + 进程内 mock 执行服务）
process.env.FAUX_DEMO = "1";
await import("../src/server.js");
export {};
