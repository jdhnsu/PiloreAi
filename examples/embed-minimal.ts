/**
 * 最小嵌入示例：把 PiLore 教学会话引入你自己的项目。
 * 无需 API key、无需 agent-design/ 目录、无需远程沙箱——全部依赖就地替换：
 *   - models:   fauxProvider 脚本化回复（真实项目换成自有模型集合 / createModelCollection()）
 *   - personas: parsePersona 从内嵌字符串构造（真实项目可来自配置中心/数据库）
 *   - exec:     自定义 ExecClient（真实项目换成自建沙箱或 codapi）
 * 运行: npx tsx examples/embed-minimal.ts
 */
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createEduSession,
	parsePersona,
	VirtualFS,
	type EduEvent,
	type ExecClient,
} from "../src/index.js";

// 1. 自定义老师：从任意字符串解析（frontmatter + 方法论正文），完全不碰磁盘
const myTeacher = parsePersona(
	[
		"---",
		"name: Guide",
		"description: 示例老师，用类比把抽象概念讲明白。触发词：打个比方、听不懂。",
		"capabilities:",
		"  file.modify: deny",
		"---",
		"你是一位示例老师 Guide。讲解时先打一个生活化的类比，再用一段最小代码示例验证。",
	].join("\n"),
	"guide.md", // key 取文件名去 .md → "guide"
);

// 2. 自定义执行后端：实现 ExecClient 接口即可（这里是进程内假实现）
const myExec: ExecClient = {
	exec: async (req) => ({
		id: "embed:1",
		ok: true,
		duration: 1,
		stdout: `(embed 沙箱) sandbox=${req.sandbox}, 收到 ${Object.keys(req.files).length} 个文件`,
		stderr: "",
	}),
};

// 3. 模型集合：演示用 fauxProvider；真实项目换成 createModelCollection() + 你的 API key
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("adopt_persona", { persona: "guide" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(
		[fauxToolCall("run_code", { sandbox: "python", entry: "demo.py" })],
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("闭包就像背包：函数离开时把它创建时的变量「背」在身上，之后还能取用。", { stopReason: "stop" }),
]);

// 4. 自定义工作区（可选）：预置学习者已有文件；缺省内部新建空 VFS
const vfs = new VirtualFS();
vfs.write("demo.py", "print('hello from embed workspace')");

const session = createEduSession({
	models,
	providerId: "faux",
	modelId: "faux-1",
	personas: [myTeacher],
	exec: myExec,
	vfs,
});

// 4. 消费 EduEvent 纯 JSON 流——换成 SSE/WebSocket/任意 UI 渲染即可
const render = (event: EduEvent): void => {
	if (event.type === "text_delta") process.stdout.write(event.delta);
	if (event.type === "tool_start") console.log(`\n[工具] ${event.toolName} ${JSON.stringify(event.args)}`);
	if (event.type === "tool_end") console.log(`[结果] ${event.text.replace(/\n/g, " ")}`);
	if (event.type === "persona") console.log(`\n[切换] ${event.persona ? `@${event.persona}` : "自动路由"}（${event.source}）`);
	if (event.type === "done") console.log("\n--- done ---");
};

session.setPersona(null); // 可选：直接设置/清除老师（@ 前缀也能在 prompt 文本里达到同样效果）

console.log(`model: ${session.modelInfo}\n`);
await session.prompt("@guide 什么是闭包？", render);
console.log(`工作区文件: ${session.listFiles().join(", ") || "(空)"}`);
