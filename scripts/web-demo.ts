// 演示模式入口：无需 API key（fauxProvider + 进程内 mock 执行服务）
export {};
process.env.FAUX_DEMO = "1";
const { main } = await import("../src/adapters/web/index.js");
await main();
