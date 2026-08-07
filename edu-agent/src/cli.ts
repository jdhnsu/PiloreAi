import "dotenv/config";
import readline from "node:readline/promises";
import { createAgent } from "./agent.js";
import { attachConsoleRenderer } from "./render.js";

const HELP = `命令:
  /quit   退出
  /abort  中断当前交互
  /help   显示帮助`;

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function bubble(text: string, color: string): void {
	const width = process.stdout.columns || 80;
	const lines = text.split("\n");
	for (const line of lines) {
		const pad = Math.max(0, width - line.length - 4);
		console.log(`${color}${" ".repeat(pad)}│ ${line} │${RESET}`);
	}
}

function main(): void {
	const { agent, model } = createAgent();
	attachConsoleRenderer(agent);
	console.log(`PiLore 教育 agent 已就绪（model: ${model.provider}/${model.id}）`);
	console.log(`${HELP}\n`);

	let busy = false;
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const ask = () => process.stdout.write(`${CYAN}❯${RESET} `);

	rl.on("line", (line) => {
		const text = line.trim();
		if (!text) {
			if (!busy) ask();
			return;
		}
		if (text === "/quit") {
			rl.close();
			process.exit(0);
		}
		if (text === "/help") {
			console.log(HELP);
			ask();
			return;
		}
		if (text === "/abort") {
			if (busy) {
				console.log("\n[中断中...]");
				agent.abort();
			} else {
				console.log("当前没有运行中的任务");
				ask();
			}
			return;
		}
		if (busy) {
			console.log("(agent 正在处理上一条消息，输入 /abort 可中断)");
			return;
		}
		busy = true;
		void (async () => {
			try {
				await agent.prompt(text);
				if (agent.state.errorMessage) console.log(`\n[错误] ${agent.state.errorMessage}`);
			} catch (err) {
				console.error(`\n[运行失败] ${err instanceof Error ? err.message : String(err)}`);
			} finally {
				busy = false;
				ask();
			}
		})();
	});

	rl.on("SIGINT", () => {
		if (busy) {
			console.log("\n[中断中...]");
			agent.abort();
		} else {
			rl.close();
			process.exit(0);
		}
	});

	ask();
}

main();
