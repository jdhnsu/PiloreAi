import "dotenv/config";
import readline from "node:readline/promises";
import { createAgent } from "./agent.js";
import { PERSONAS, getPersona, type Persona } from "./personas.js";
import { attachConsoleRenderer, personaBanner } from "./render.js";

const HELP = `命令:
  /quit   退出
  /abort  中断当前交互
  /help   显示帮助
老师:
  @feynman 问题   指定费曼式讲解（大白话/类比）
  @socrates 问题  指定苏格拉底式讲解（讲透原理）
  @oris 问题      指定搭脚手架式讲解（补前置基础）
  不带 @ 时由 PiLore 自动判断`;

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
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
	let currentPersona: Persona | undefined;
	attachConsoleRenderer(agent, { onPersonaChange: (p) => (currentPersona = p) });
	console.log(`PiLore 教育 agent 已就绪（model: ${model.provider}/${model.id}）`);
	console.log(`${HELP}\n`);

	let busy = false;
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const ask = () => {
		if (currentPersona) process.stdout.write(`${MAGENTA}[${currentPersona.name}]${RESET} `);
		process.stdout.write(`${CYAN}❯${RESET} `);
	};

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
		// @老师 前缀：直接指定教学方法，转为【指定教学方法】前缀注入；@pilore 切回自动路由
		let message = text;
		if (text.startsWith("@")) {
			const mention = text.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)\s+([\s\S]+)$/);
			const available = PERSONAS.map((p) => `@${p.key}`).join(" / ");
			if (!mention) {
				console.log(`用法: @feynman 你的问题（可用: ${available} / @pilore）`);
				ask();
				return;
			}
			const key = mention[1].toLowerCase();
			if (key === "pilore") {
				currentPersona = undefined;
				console.log("[老师] 已切回 PiLore 自动路由");
				message = mention[2];
			} else {
				const persona = getPersona(key);
				if (!persona) {
					console.log(`没有这位老师: @${mention[1]}（可用: ${available} / @pilore）`);
					ask();
					return;
				}
				currentPersona = persona;
				console.log(personaBanner(persona, "用户指定"));
				message = `【指定教学方法：${persona.name}】${mention[2]}`;
			}
		}
		busy = true;
		void (async () => {
			try {
				await agent.prompt(message);
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
