import "dotenv/config";
import { createModelCollection } from "../src/agent.js";

/** 打印已注册 provider 的可用模型，用于确认 MODEL_ID。用法: npm run list-models [providerId] */

const filter = process.argv[2];
const models = createModelCollection();

for (const provider of models.getProviders()) {
	if (filter && provider.id !== filter) continue;
	console.log(`\n=== ${provider.id} (${provider.name}) ===`);
	const list = models.getModels(provider.id);
	if (list.length === 0) {
		console.log("  (无模型)");
		continue;
	}
	for (const m of list) {
		const parts = [
			m.id.padEnd(28),
			m.name ?? "",
			m.reasoning ? "reasoning" : "",
			m.contextWindow ? `ctx=${m.contextWindow}` : "",
		];
		console.log(`  ${parts.filter(Boolean).join(" | ")}`);
	}
}

console.log("\n提示: provider 的 API key 从环境变量解析（DEEPSEEK_API_KEY / MOONSHOT_API_KEY），见 .env.example");
