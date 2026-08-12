import "dotenv/config";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	createCodeMentorSession,
	createEnglishMentorSession,
	getDefaultCodeProfiles,
	getDefaultEnglishProfiles,
	type ProfileDefinition,
	type Session,
	type SessionEvent,
} from "../../index.js";
const CYAN = "\x1b[36m", MAGENTA = "\x1b[35m", RESET = "\x1b[0m";
function render(event: SessionEvent): void { if (event.type === "text_delta") process.stdout.write(event.delta); else if (event.type === "message_end") process.stdout.write("\n"); else if (event.type === "tool_start") process.stdout.write(`\n[工具] ${event.toolName}\n`); else if (event.type === "tool_end") process.stdout.write(`${event.isError ? "[错误]" : "[结果]"} ${event.text}\n`); else if (event.type === "profile") process.stdout.write(`\n[导师] ${event.name ?? "自动路由"}\n`); else if (event.type === "toolset") process.stdout.write(`\n[工具组] ${event.toolset} 已加载\n`); else if (event.type === "error") process.stdout.write(`\n[错误] ${event.message}\n`); }

interface CliSession extends Session { readonly modelInfo: string }
interface CliPack { id: string; name: string; help(): string; create(): CliSession }

const PACKS: CliPack[] = [
	{ id: "code", name: "PiLore 编程导师", help: () => mentorHelp(getDefaultCodeProfiles()), create: () => createCodeMentorSession() },
	{ id: "english", name: "PiLore 英语导师", help: () => mentorHelp(getDefaultEnglishProfiles()), create: () => createEnglishMentorSession() },
];

function mentorHelp(profiles: ProfileDefinition[]): string {
	return `导师:\n${profiles.map((p) => `  @${p.key} 问题  指定 ${p.name}`).join("\n")}\n  @pilore 问题  自动路由`;
}
function usage(): string {
	return `用法: npm run chat -- [--pack <id>] [--list]\n\n可用包:\n${PACKS.map((p) => `  ${p.id.padEnd(10)} ${p.name}`).join("\n")}`;
}
function resolvePack(args: string[]): CliPack | { exit: string } {
	if (args.includes("--list") || args.includes("--help") || args.includes("-h")) return { exit: usage() };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const pick = (id: string | undefined): CliPack | { exit: string } => { const pack = PACKS.find((p) => p.id === id?.trim().toLowerCase()); return pack ?? { exit: `未知包: ${id}\n\n${usage()}` }; };
		if (arg === "--pack") return pick(args[i + 1]);
		if (arg.startsWith("--pack=")) return pick(arg.slice("--pack=".length));
		if (!arg.startsWith("-")) return pick(arg);
	}
	return PACKS[0];
}

export function main(argv: string[] = process.argv.slice(2)): void {
	const choice = resolvePack(argv);
	if ("exit" in choice) { console.log(choice.exit); return; }
	const session = choice.create();
	const help = `命令: /quit /abort /help\n${choice.help()}`;
	console.log(`${choice.name} 已就绪（${session.modelInfo}）\n${help}`);
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = () => process.stdout.write(`${session.profile ? `${MAGENTA}[${session.profile}]${RESET} ` : ""}${CYAN}❯${RESET} `);
	ask();
	rl.on("line", (line) => { const text = line.trim(); if (!text) return ask(); if (text === "/quit") { rl.close(); return; } if (text === "/help") { console.log(help); return ask(); } if (text === "/abort") { session.abort(); return; } if (session.busy) { console.log("正在处理上一条消息"); return; } void session.prompt(text, render).finally(ask); });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
