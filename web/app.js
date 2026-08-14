"use strict";

const $ = (sel) => document.querySelector(sel);
const messagesEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send");
const abortBtn = $("#abort");
const personaBadge = $("#persona-badge");
const demoBadge = $("#demo-badge");
const modelInfo = $("#model-info");
const modelNameEl = $("#model-name");
const fileList = $("#file-list");
const resetChip = $("#reset-persona");
const composerEl = $("#composer");
const personaHintEl = $("#persona-hint");
const sessionListEl = $("#session-list");
const storageBadgeEl = $("#storage-badge");
const welcomeEl = messagesEl.querySelector(".welcome");
const packSelect = $("#pack-select");
const packCurrentEl = $("#pack-current");
const packOptionsEl = $("#pack-options");
const welcomeTitle = $("#welcome-title");
const welcomeDesc = $("#welcome-desc");
const suggestionsEl = $("#suggestions");
const chipsEl = $("#chips");
const wsTitle = $("#ws-title");
const trajectoryEl = $("#trajectory");
const chatTab = $("#tab-chat");
const trajTab = $("#tab-trajectory");
const themeToggle = $("#theme-toggle");

let busy = false;

function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;
	const dark = theme === "dark";
	themeToggle.textContent = dark ? "☀" : "☾";
	themeToggle.title = dark ? "切换浅色主题" : "切换暗色主题";
	themeToggle.setAttribute("aria-label", themeToggle.title);
}

applyTheme(localStorage.getItem("pilore-theme") || "light");
themeToggle.onclick = () => {
	const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
	localStorage.setItem("pilore-theme", next);
	applyTheme(next);
};
let packs = []; // 可用学习包：{ id, name, tagline, suggestions, profiles }
let currentPack = "code"; // 当前学习包 id
let currentProfileKey = null; // 当前 profile key；null = 自动路由
let currentPersona = null; // 当前老师名（展示用）；null = PiLore 自动路由
let currentFile = null; // 工作区当前展开的文件 { path, content }

const TOOL_GLYPHS = {
	write_file: "✎",
	read_file: "≡",
	run_code: "▶",
	learn_word: "✚",
	list_words: "☰",
	forget_word: "✕",
	start_practice: "✍",
	submit_answer: "✓",
};
const TOOL_LABELS = {
	write_file: "写入",
	read_file: "读取",
	run_code: "运行",
	adopt_persona: "切换老师",
	learn_word: "收录",
	list_words: "查看词汇",
	forget_word: "移除",
	start_practice: "发起练习",
	submit_answer: "提交答案",
};

function esc(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const mathTypesetStates = new WeakMap();

function queueMathTypeset(el) {
	const mathJax = window.MathJax;
	if (!mathJax?.startup?.promise || !mathJax.typesetPromise) return;
	let state = mathTypesetStates.get(el);
	if (!state) {
		state = { queued: false, running: null };
		mathTypesetStates.set(el, state);
	}
	state.queued = true;
	if (state.running) return;
	state.running = (async () => {
		await mathJax.startup.promise;
		while (state.queued) {
			state.queued = false;
			mathJax.typesetClear?.([el]);
			await mathJax.typesetPromise([el]);
		}
	})()
		.catch(() => {})
		.finally(() => {
			state.running = null;
		});
}

function renderMathMarkdown(el, source) {
	el.innerHTML = renderMarkdown(source);
	queueMathTypeset(el);
}

/* ---------- Markdown 渲染：代码块(带高亮)/表格/引用/标题/列表，先转义再套标签 ---------- */

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uffee]/;

function renderMarkdown(src) {
	const lines = src.split("\n");
	let html = "";
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		// 围栏代码块 ```lang（流式中未闭合则一直吃到末尾）
		const fence = line.match(/^```(.*)$/);
		if (fence) {
			const lang = fence[1].trim();
			const buf = [];
			i++;
			while (i < lines.length && !/^```\s*$/.test(lines[i])) {
				buf.push(lines[i]);
				i++;
			}
			i++;
			html += codeBlockHtml(buf.join("\n"), lang);
			continue;
		}

		// 表格：表头行 + |---|---| 分隔行
		if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
			const aligns = parseAligns(lines[i + 1]);
			const rows = [splitRow(line)];
			i += 2;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
				rows.push(splitRow(lines[i]));
				i++;
			}
			html += tableHtml(rows, aligns);
			continue;
		}

		// 引用块 >（剥一层前缀后递归，支持嵌套内容）
		if (/^\s*>/.test(line)) {
			const buf = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) {
				buf.push(lines[i].replace(/^\s*> ?/, ""));
				i++;
			}
			html += `<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`;
			continue;
		}

		// 标题（聊天卡片内统一压到 h1-h3 尺寸）
		const h = line.match(/^(#{1,6})\s+(.*)$/);
		if (h) {
			const lvl = Math.min(h[1].length, 3);
			html += `<h${lvl}>${renderInline(esc(h[2]))}</h${lvl}>`;
			i++;
			continue;
		}

		if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			html += "<hr>";
			i++;
			continue;
		}

		// 列表（同一块内不混排有序/无序）
		if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
			const ordered = /^\s*\d/.test(line);
			const items = [];
			while (i < lines.length) {
				const m = lines[i].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
				if (!m || /^\s*\d/.test(lines[i]) !== ordered) break;
				items.push(m[1]);
				i++;
			}
			const tag = ordered ? "ol" : "ul";
			html += `<${tag}>${items.map((t) => `<li>${renderInline(esc(t))}</li>`).join("")}</${tag}>`;
			continue;
		}

		if (line.trim() === "") {
			i++;
			continue;
		}

		// 段落：合并连续普通行（中文相邻处不加空格）
		const buf = [line];
		i++;
		while (i < lines.length && isPlainLine(lines[i])) {
			buf.push(lines[i]);
			i++;
		}
		html += `<p>${renderInline(esc(joinCjk(buf)))}</p>`;
	}
	return html;
}

function isPlainLine(line) {
	if (line.trim() === "") return false;
	return !(
		/^```/.test(line) ||
		/^#{1,6}\s/.test(line) ||
		/^\s*>/.test(line) ||
		/^\s*(?:[-*+]|\d+[.)])\s+/.test(line) ||
		/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
	);
}

function joinCjk(lines) {
	let s = lines[0];
	for (let k = 1; k < lines.length; k++) {
		const glue = CJK_RE.test(lines[k - 1].slice(-1)) || CJK_RE.test(lines[k][0]) ? "" : " ";
		s += glue + lines[k];
	}
	return s;
}

/* 行内语法：`code`、**加粗**、*斜体*、[链接](url)；行内代码先占位，避免内部被再处理 */
function renderInline(escaped) {
	const codes = [];
	let s = escaped.replace(/`([^`]+)`/g, (_, c) => {
		codes.push(`<code>${c}</code>`);
		return `\u0000${codes.length - 1}\u0000`;
	});
	s = s
		.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
		.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>")
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
	return s.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}

/* ---------- 表格 ---------- */

function splitRow(row) {
	let t = row.trim();
	if (t.startsWith("|")) t = t.slice(1);
	if (t.endsWith("|")) t = t.slice(0, -1);
	// 行内代码里的 | 不参与切分
	const codes = [];
	t = t.replace(/`[^`]+`/g, (m) => {
		codes.push(m);
		return `\u0000${codes.length - 1}\u0000`;
	});
	return t
		.split(/(?<!\\)\|/)
		.map((c) => c.trim().replace(/\\\|/g, "|").replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]));
}

function isTableSep(line) {
	const cells = splitRow(line);
	return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function parseAligns(sep) {
	return splitRow(sep).map((c) => {
		const t = c.trim();
		const left = t.startsWith(":");
		const right = t.endsWith(":");
		if (left && right) return "center";
		return right ? "right" : "";
	});
}

function tableHtml(rows, aligns) {
	const alignAttr = (j) => (aligns[j] ? ` style="text-align:${aligns[j]}"` : "");
	let html = '<div class="table-wrap"><table><thead><tr>';
	rows[0].forEach((c, j) => {
		html += `<th${alignAttr(j)}>${renderInline(esc(c))}</th>`;
	});
	html += "</tr></thead><tbody>";
	for (let r = 1; r < rows.length; r++) {
		html += "<tr>";
		rows[0].forEach((_, j) => {
			html += `<td${alignAttr(j)}>${renderInline(esc(rows[r][j] ?? ""))}</td>`;
		});
		html += "</tr>";
	}
	return html + "</tbody></table></div>";
}

/* ---------- 轻量语法高亮（本地实现，无第三方依赖） ---------- */

function kwRe(words, flags = "") {
	return new RegExp(`\\b(?:${words})\\b`, "y" + flags);
}

const HL_NUM = /\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y;

const HL_WORDS = {
	js: "abstract|arguments|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|return|set|static|switch|this|throw|try|type|typeof|var|void|while|with|yield",
	jsConst: "true|false|null|undefined|NaN|Infinity|globalThis|console|window|document|Math|JSON|Promise|Object|Array|String|Number|Boolean|Map|Set|RegExp|Error|Symbol",
	py: "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield",
	pyConst: "True|False|None|self|cls|print|len|range|str|int|float|list|dict|set|tuple|bool|open|type|isinstance|enumerate|zip|map|filter|sorted|sum|min|max|abs|input|super",
	c: "auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|bool|true|false|nil|string|func|chan|defer|go|map|package|range|select|trait|impl|mut|pub|use|mod|match|loop|fn|crate|dyn|box",
	java: "abstract|assert|boolean|byte|case|catch|char|class|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|record|var|sealed|permits|null",
	sql: "select|from|where|insert|into|values|update|set|delete|create|table|drop|alter|add|join|left|right|inner|outer|full|on|group|by|order|having|limit|offset|distinct|as|and|or|not|null|primary|key|foreign|references|index|view|union|all|exists|in|between|like|is|case|when|then|else|end|asc|desc|with",
};

const HL = {
	python: {
		alias: ["py"],
		rules: [
			{ t: "com", r: /#[^\n]*/y },
			{ t: "str", r: /(?:[rbfRBF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y },
			{ t: "kw", r: kwRe(HL_WORDS.py) },
			{ t: "const", r: kwRe(HL_WORDS.pyConst) },
			{ t: "fn", r: /[A-Za-z_]\w*(?=\s*\()/y },
			{ t: "num", r: HL_NUM },
		],
	},
	javascript: {
		alias: ["js", "jsx", "ts", "tsx", "typescript", "node"],
		rules: [
			{ t: "com", r: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
			{ t: "str", r: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[\s\S])*?`/y },
			{ t: "kw", r: kwRe(HL_WORDS.js) },
			{ t: "const", r: kwRe(HL_WORDS.jsConst) },
			{ t: "fn", r: /[A-Za-z_$][\w$]*(?=\s*\()/y },
			{ t: "num", r: HL_NUM },
		],
	},
	json: {
		rules: [
			{ t: "key", r: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
			{ t: "str", r: /"(?:\\.|[^"\\])*"/y },
			{ t: "kw", r: /\b(?:true|false|null)\b/y },
			{ t: "num", r: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
		],
	},
	bash: {
		alias: ["sh", "shell", "zsh", "console", "terminal", "cmd"],
		rules: [
			{ t: "com", r: /#[^\n]*/y },
			{ t: "str", r: /"(?:\\.|[^"\\])*"|'[^']*'/y },
			{ t: "kw", r: kwRe("if|then|else|elif|fi|for|while|do|done|case|esac|function|in|echo|cd|ls|cat|grep|sudo|export|source|pip|npm|npx|node|python|git|curl|mkdir|rm|cp|mv") },
			{ t: "var", r: /\$\w+|\$\{[^}]*\}/y },
			{ t: "num", r: HL_NUM },
		],
	},
	html: {
		alias: ["xml", "svg"],
		rules: [
			{ t: "com", r: /<!--[\s\S]*?-->/y },
			{ t: "str", r: /"[^"]*"|'[^']*'/y },
			{ t: "tag", r: /<\/?[a-zA-Z][\w:-]*|\/?>/y },
			{ t: "attr", r: /[a-zA-Z_:][\w:-]*(?==)/y },
		],
	},
	css: {
		rules: [
			{ t: "com", r: /\/\*[\s\S]*?\*\//y },
			{ t: "str", r: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y },
			{ t: "const", r: /#[0-9a-fA-F]{3,8}\b/y },
			{ t: "attr", r: /[a-zA-Z-]+(?=\s*:)/y },
			{ t: "num", r: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/y },
		],
	},
	sql: {
		rules: [
			{ t: "com", r: /--[^\n]*|\/\*[\s\S]*?\*\//y },
			{ t: "str", r: /'(?:''|[^'\n])*'/y },
			{ t: "kw", r: kwRe(HL_WORDS.sql, "i") },
			{ t: "num", r: HL_NUM },
		],
	},
	clike: {
		alias: ["c", "cpp", "c++", "java", "cs", "csharp", "go", "rust", "kotlin", "swift", "php"],
		rules: [
			{ t: "com", r: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
			{ t: "str", r: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y },
			{ t: "kw", r: kwRe([HL_WORDS.c, HL_WORDS.java].join("|")) },
			{ t: "fn", r: /[A-Za-z_]\w*(?=\s*\()/y },
			{ t: "num", r: HL_NUM },
		],
	},
};

// 未知语言兜底：至少高亮注释/字符串/数字
const HL_GENERIC = [
	{ t: "com", r: /#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
	{ t: "str", r: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[\s\S])*?`/y },
	{ t: "num", r: HL_NUM },
];

function resolveRules(lang) {
	const key = (lang ?? "").toLowerCase();
	for (const [name, def] of Object.entries(HL)) {
		if (name === key || def.alias?.includes(key)) return def.rules;
	}
	return HL_GENERIC;
}

/* 规则定义为 sticky；扫描需要向前查找，这里惰性转成等价的 global 版本 */
function scanRe(rule) {
	return (rule.g ??= new RegExp(rule.r.source, rule.r.flags.replace("y", "g")));
}

/* 从左到右扫描：优先位置最靠前的规则，同位置按规则顺序（优先级） */
function highlightCode(code, lang) {
	const rules = resolveRules(lang);
	let out = "";
	let i = 0;
	while (i < code.length) {
		let next = code.length;
		for (const rule of rules) {
			const re = scanRe(rule);
			re.lastIndex = i;
			const m = re.exec(code);
			if (!m) continue;
			if (m.index === i) {
				out += `<span class="tok-${rule.t}">${esc(m[0])}</span>`;
				i += m[0].length || 1;
				next = -1;
				break;
			}
			if (m.index < next) next = m.index;
		}
		if (next >= 0) {
			out += esc(code.slice(i, next));
			i = next;
		}
	}
	return out;
}

function codeBlockHtml(code, lang) {
	const head = lang ? `<div class="code-head">${esc(lang)}</div>` : "";
	return `<div class="code-block">${head}<pre><code>${highlightCode(code, lang)}</code></pre></div>`;
}

function argsSummary(args) {
	if (!args || typeof args !== "object") return "";
	const values = Object.values(args).map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
	const text = values.join(" ");
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** 检查消息容器是否已滚动到底部 */
function isAtBottom() {
	return messagesEl.scrollHeight - messagesEl.clientHeight <= messagesEl.scrollTop + 10;
}

/** 标记：用户是否已手动上移阅读（防止自动滚回干扰） */
let userScrolledAway = false;

/** 监听用户手动滚动行为 */
messagesEl.addEventListener("scroll", () => {
	// 记录用户是否把滚动条拉上去阅读旧内容
	// 只要距离底部超过 10px，就视为用户主动上移
	const atBottom = isAtBottom();
	userScrolledAway = !atBottom;
}, { passive: true });

/* requestAnimationFrame 节流：把多次事件触发的滚动合并到一帧，避免流式输出时反复强制滚动导致卡顿 */
let scrollFrame = null;
function scrollToBottom() {
	if (scrollFrame !== null) return;
	scrollFrame = requestAnimationFrame(() => {
		scrollFrame = null;
		// 用户主动上移阅读时，不强制滚回底部（保留其阅读位置）
		if (!userScrolledAway) {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}
	});
}

/* 一轮对话的 assistant 容器：文本段与工具卡片按到达顺序交错 */
function createAssistantBlock() {
	const welcome = messagesEl.querySelector(".welcome");
	if (welcome) welcome.remove();
	const card = document.createElement("div");
	card.className = "msg-assistant card";
	messagesEl.appendChild(card);
	const block = { card, textEl: null, textBuf: "", lastTool: null, badgeEl: null };
	if (currentPersona) setBlockBadge(block, currentPersona);
	return block;
}

function ensureTextEl(block) {
	if (!block.textEl) {
		block.textEl = document.createElement("div");
		block.textEl.className = "msg-text";
		appendBlock(block, block.textEl);
		block.textBuf = "";
	}
	return block.textEl;
}

function closeTextSegment(block) {
	block.textEl = null;
	block.textBuf = "";
}

function setPersonaBadge(name) {
	if (!name) {
		personaBadge.classList.add("hidden");
		return;
	}
	personaBadge.textContent = name;
	personaBadge.classList.remove("hidden");
}

function applyPersona(name) {
	currentPersona = name ?? null;
	setPersonaBadge(name);
	resetChip.classList.toggle("hidden", !name);
	personaHintEl.classList.toggle("hidden", !name);
	personaHintEl.textContent = name ? `由 ${name} 回答` : "";
	inputEl.placeholder = name ? `向 ${name} 提问…` : "向 PiLore 提问…";
}

/* 卡片右下角老师徽标；徽标存在时新内容一律插在它前面，保证它始终在右下角 */
function setBlockBadge(block, name) {
	if (!block.badgeEl) {
		block.badgeEl = document.createElement("div");
		block.badgeEl.className = "msg-footer";
		block.badgeEl.innerHTML = '<span class="persona-tag"></span>';
		block.card.appendChild(block.badgeEl);
	}
	const tag = block.badgeEl.querySelector(".persona-tag");
	tag.textContent = name ?? "PiLore";
	tag.classList.toggle("pilore", !name);
}

function appendBlock(block, el) {
	if (block.badgeEl) block.card.insertBefore(el, block.badgeEl);
	else block.card.appendChild(el);
}

function handleEvent(ev, block) {
	switch (ev.type) {
		case "text_delta": {
			const el = ensureTextEl(block);
			block.textBuf += ev.delta;
			renderMathMarkdown(el, block.textBuf);
			break;
		}
		case "tool_start": {
			closeTextSegment(block);
			const tool = document.createElement("div");
			tool.className = "tool";
			tool.innerHTML = `
				<div class="tool-head">
					<span class="tool-glyph">${TOOL_GLYPHS[ev.toolName] ?? "•"}</span>
					<span class="tool-name">${esc(ev.toolName)}</span>
					<span class="tool-args">${esc(argsSummary(ev.args))}</span>
					<span class="tool-status running">运行中</span>
				</div>`;
			appendBlock(block, tool);
			block.lastTool = tool;
			break;
		}
		case "tool_end": {
			const tool = block.lastTool;
			if (tool) {
				const status = tool.querySelector(".tool-status");
				status.textContent = ev.isError ? "失败" : TOOL_LABELS[ev.toolName] ?? "完成";
				status.className = `tool-status ${ev.isError ? "err" : "ok"}`;
				if (ev.text) {
					const pre = document.createElement("pre");
					pre.className = "tool-output";
					pre.textContent = ev.text;
					tool.appendChild(pre);
				}
				block.lastTool = null;
			}
			break;
		}
		case "persona":
		case "profile":
			closeTextSegment(block);
			currentProfileKey = ev.profile ?? null;
			applyPersona(ev.name);
			setBlockBadge(block, ev.name);
			{
				const line = document.createElement("div");
				line.className = ev.name ? "persona-line" : "persona-line reset";
				line.textContent = ev.name
					? `[老师] ${ev.name}${ev.source === "user" ? "（你指定）" : ""}`
					: "[系统] 已切回 PiLore 自动路由";
				appendBlock(block, line);
			}
			break;
		case "toolset": {
			// 内部工具按需加载：不打断文本流，仅落一条轻提示
			if (ev.active) {
				const line = document.createElement("div");
				line.className = "system-note";
				line.textContent = `已加载工具组：${ev.toolset}`;
				appendBlock(block, line);
			}
			break;
		}
		case "error": {
			closeTextSegment(block);
			const line = document.createElement("div");
			line.className = "error-line";
			line.textContent = ev.message;
			appendBlock(block, line);
			break;
		}
		case "done":
			// 整轮没有 persona 事件时，按当前粘性老师落徽标（无则为 PiLore）
			if (!block.badgeEl) setBlockBadge(block, currentPersona);
			break;
		default:
			break;
	}
	scrollToBottom();
}

function setBusy(value) {
	busy = value;
	composerEl.classList.toggle("streaming", value);
	sendBtn.classList.toggle("hidden", value);
	abortBtn.classList.toggle("hidden", !value);
	if (!value) updateSend();
	inputEl.disabled = false;
}

/* 上下文接近模型上限时，用户明确选择压缩或改开新会话；不会静默丢弃历史。 */
function showContextRecovery(message, info = {}) {
	const card = document.createElement("div");
	card.className = "context-recovery card";
	const title = document.createElement("strong");
	title.textContent = "这段对话需要先处理上下文";
	const detail = document.createElement("p");
	const estimated = info.context?.estimatedTokens;
	detail.textContent = estimated
		? `当前上下文约 ${estimated} tokens，接近模型安全上限。压缩会保留学习目标、进度和近期对话。`
		: "当前上下文接近模型安全上限。压缩会保留学习目标、进度和近期对话。";
	const actions = document.createElement("div");
	actions.className = "context-recovery-actions";
	const compact = document.createElement("button");
	compact.type = "button";
	compact.className = "btn-primary";
	compact.textContent = "压缩并继续";
	const fresh = document.createElement("button");
	fresh.type = "button";
	fresh.className = "copy-btn";
	fresh.textContent = "新建会话";
	const error = document.createElement("div");
	error.className = "context-recovery-error hidden";
	actions.append(compact, fresh);
	card.append(title, detail, actions, error);
	messagesEl.appendChild(card);
	scrollToBottom();

	compact.onclick = async () => {
		compact.disabled = true;
		fresh.disabled = true;
		compact.textContent = "正在压缩…";
		error.classList.add("hidden");
		try {
			const resp = await fetch("/api/context/compact", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId }),
			});
			if (!resp.ok) {
				const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
				throw new Error(body.error ?? "压缩失败");
			}
			card.remove();
			await send(message);
		} catch (err) {
			error.textContent = `压缩失败：${err.message ?? err}。历史没有被修改，可以重试或新建会话。`;
			error.classList.remove("hidden");
			compact.disabled = false;
			fresh.disabled = false;
			compact.textContent = "压缩并继续";
		}
	};
	fresh.onclick = async () => {
		card.remove();
		inputEl.value = message;
		autoGrow();
		updateSend();
		await newSession();
	};
}

async function send(text) {
	const message = (text ?? inputEl.value).trim();
	if (!message || busy) return;
	inputEl.value = "";
	autoGrow();
	syncChips();
	updateSend();

	const userEl = document.createElement("div");
	userEl.className = "msg-user";
	userEl.textContent = message;
	messagesEl.appendChild(userEl);
	scrollToBottom();

	setBusy(true);
	const block = createAssistantBlock();
	try {
		const resp = await fetch("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId, message }),
		});
		if (!resp.ok || !resp.body) {
			const info = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
			if (info.code === "CONTEXT_COMPACTION_REQUIRED") {
				userEl.remove();
				block.card.remove();
				showContextRecovery(message, info);
				return;
			}
			handleEvent({ type: "error", message: info.error ?? "请求失败" }, block);
			setBusy(false);
			return;
		}
		const reader = resp.body.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let idx;
			while ((idx = buf.indexOf("\n\n")) >= 0) {
				const chunk = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				const line = chunk.split("\n").find((l) => l.startsWith("data: "));
				if (!line) continue;
				try {
					handleEvent(JSON.parse(line.slice(6)), block);
				} catch {
					/* 忽略损坏的事件帧 */
				}
			}
		}
	} catch (err) {
		handleEvent({ type: "error", message: `连接中断: ${err.message ?? err}` }, block);
	} finally {
		setBusy(false);
		refreshPanel();
		refreshSessionList(); // 首轮完成后标题/时间有变化
		if (viewMode === "trajectory") void loadTrajectory();
	}
}

/* ---------- 轨迹视图：对话 / 轨迹 切换与渲染 ---------- */

let viewMode = "chat";

function formatMs(ms) {
	if (!Number.isFinite(ms)) return "—";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

function formatTime(ts) {
	return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function usageSummary(turn) {
	const u = turn.usage;
	if (!u) return "";
	const parts = [];
	const input = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
	if (input > 0) parts.push(`输入 ${input} tok`);
	if (u.output > 0) parts.push(`输出 ${u.output} tok`);
	if (u.cacheRead > 0) parts.push(`缓存命中 ${u.cacheRead}`);
	if (u.cacheWrite > 0) parts.push(`缓存写入 ${u.cacheWrite}`);
	if (typeof u.cost?.total === "number" && u.cost.total > 0) parts.push(`费用 ${u.cost.total.toFixed(4)}`);
	return parts.join(" · ");
}

/* 会话累计用量：从第一轮开始逐轮累加，供每轮展示"到目前为止"的总数据 */

function addUsageInto(target, usage) {
	if (!usage) return target;
	target.input += usage.input ?? 0;
	target.cacheRead += usage.cacheRead ?? 0;
	target.cacheWrite += usage.cacheWrite ?? 0;
	target.output += usage.output ?? 0;
	target.cost += typeof usage.cost?.total === "number" ? usage.cost.total : 0;
	return target;
}

function formatPercent(rate) {
	if (!Number.isFinite(rate) || rate < 0) return "—";
	return `${Math.round(rate * 1000) / 10}%`;
}

function cumulativeSummary(total) {
	const input = total.input + total.cacheRead + total.cacheWrite;
	if (input === 0 && total.output === 0 && total.cost === 0) return "";
	const parts = [];
	if (input > 0) parts.push(`输入 ${input} tok`);
	if (total.output > 0) parts.push(`输出 ${total.output} tok`);
	if (total.cacheRead > 0) parts.push(`缓存命中 ${total.cacheRead}`);
	if (input > 0) parts.push(`命中率 ${formatPercent(total.cacheRead / input)}`);
	if (total.cost > 0) parts.push(`费用 ${total.cost.toFixed(4)}`);
	return parts.join(" · ");
}

function detailSection(title, text) {
	const el = document.createElement("div");
	el.className = "trajectory-detail-section";
	const h = document.createElement("div");
	h.className = "trajectory-detail-title";
	h.textContent = title;
	const pre = document.createElement("pre");
	pre.className = "trajectory-detail-pre";
	pre.textContent = text ?? "—";
	el.append(h, pre);
	return el;
}

function renderTrajectoryStep(step) {
	if (step.kind === "text") {
		const el = document.createElement("div");
		el.className = "trajectory-text msg-text";
		renderMathMarkdown(el, step.text);
		return el;
	}
	if (step.kind === "profile") {
		const el = document.createElement("div");
		el.className = step.name ? "persona-line" : "persona-line reset";
		el.textContent = step.name
			? `[老师] ${step.name}${step.source === "user" ? "（你指定）" : ""}`
			: "[系统] 已切回 PiLore 自动路由";
		return el;
	}
	if (step.kind === "toolset") {
		const el = document.createElement("div");
		el.className = "system-note";
		el.textContent = step.active ? `已加载工具组：${step.toolset}` : `已卸载工具组：${step.toolset}`;
		return el;
	}
	const tool = document.createElement("div");
	tool.className = "tool";
	const head = document.createElement("div");
	head.className = "tool-head";
	head.innerHTML = `
		<span class="tool-glyph">${TOOL_GLYPHS[step.toolName] ?? "•"}</span>
		<span class="tool-name">${esc(step.toolName)}</span>
		<span class="tool-args">${esc(argsSummary(step.args))}</span>
		<span class="tool-status ${step.isError ? "err" : "ok"}">${step.isError ? "失败" : TOOL_LABELS[step.toolName] ?? "完成"}</span>`;
	const duration = document.createElement("span");
	duration.className = "tool-duration";
	duration.textContent = formatMs(step.durationMs);
	head.appendChild(duration);
	tool.appendChild(head);
	if (step.resultText) {
		const pre = document.createElement("pre");
		pre.className = "tool-output";
		pre.textContent = step.resultText;
		tool.appendChild(pre);
		if (step.resultTruncated) {
			const note = document.createElement("div");
			note.className = "trajectory-truncated-note";
			note.textContent = "（结果过长，已截断）";
			tool.appendChild(note);
		}
	}
	const extra = document.createElement("details");
	extra.className = "trajectory-tool-extra";
	const summary = document.createElement("summary");
	summary.textContent = step.schema
		? `调用详情：参数 / Schema · ${step.schema.label ?? step.schema.name}`
		: "调用详情：参数";
	extra.appendChild(summary);
	const body = document.createElement("div");
	body.className = "trajectory-detail-body";
	body.appendChild(detailSection("参数", JSON.stringify(step.args ?? null, null, 2)));
	if (step.schema) {
		const schemaText = [step.schema.description || "", JSON.stringify(step.schema.parameters, null, 2)]
			.filter((part) => part !== "")
			.join("\n\n");
		body.appendChild(detailSection(`Schema · ${step.schema.name}`, schemaText || "—"));
	}
	extra.appendChild(body);
	tool.appendChild(extra);
	return tool;
}

function renderTrajectoryTurn(turn, cumulative) {
	const wrap = document.createElement("div");
	wrap.className = "trajectory-turn";
	const head = document.createElement("div");
	head.className = "trajectory-turn-head";
	const label = document.createElement("span");
	label.className = "trajectory-turn-label";
	label.textContent = turn.turn === 0 ? "前导" : `第 ${turn.turn} 轮`;
	head.appendChild(label);
	if (turn.profileName) {
		const persona = document.createElement("span");
		persona.className = "persona-tag";
		persona.textContent = turn.profileName;
		head.appendChild(persona);
	}
	if (turn.provider && turn.model) {
		const model = document.createElement("span");
		model.className = "trajectory-model";
		model.textContent = `${turn.provider}/${turn.model}`;
		head.appendChild(model);
	}
	const meta = document.createElement("span");
	meta.className = "trajectory-turn-meta";
	meta.textContent = formatMs(turn.durationMs);
	head.appendChild(meta);
	wrap.appendChild(head);
	if (turn.systemPrompt !== undefined || (turn.tools?.length ?? 0) > 0) {
		const request = document.createElement("details");
		request.className = "trajectory-request";
		const summary = document.createElement("summary");
		summary.textContent = `系统提示词与工具目录（${turn.tools?.length ?? 0} 个工具）`;
		request.appendChild(summary);
		const body = document.createElement("div");
		body.className = "trajectory-detail-body";
		if (turn.systemPrompt !== undefined) {
			body.appendChild(detailSection("System Prompt", turn.systemPrompt));
		}
		for (const tool of turn.tools ?? []) {
			const text = [tool.description || "", JSON.stringify(tool.parameters, null, 2)]
				.filter((part) => part !== "")
				.join("\n\n");
			body.appendChild(detailSection(`工具 · ${tool.name}${tool.label ? `（${tool.label}）` : ""}`, text || "—"));
		}
		request.appendChild(body);
		wrap.appendChild(request);
	}
	for (const step of turn.steps) wrap.appendChild(renderTrajectoryStep(step));
	addUsageInto(cumulative, turn.usage);
	const usage = usageSummary(turn);
	const cumulativeText = cumulativeSummary(cumulative);
	if (usage || cumulativeText) {
		const foot = document.createElement("div");
		foot.className = "trajectory-turn-foot";
		if (usage) {
			const line = document.createElement("span");
			line.className = "trajectory-turn-usage";
			line.textContent = `本次 · ${usage}`;
			foot.appendChild(line);
		}
		if (cumulativeText) {
			const line = document.createElement("span");
			line.className = "trajectory-turn-cumulative";
			line.textContent = `累计 · ${cumulativeText}`;
			foot.appendChild(line);
		}
		wrap.appendChild(foot);
	}
	return wrap;
}

function renderTrajectoryRun(run, cumulative) {
	const section = document.createElement("section");
	section.className = "trajectory-run card";
	const head = document.createElement("div");
	head.className = "trajectory-run-head";
	const question = document.createElement("div");
	question.className = "trajectory-question";
	question.textContent = run.input || "（无输入）";
	const meta = document.createElement("div");
	meta.className = "trajectory-run-meta";
	meta.textContent = `${formatTime(run.startedAt)} · 耗时 ${formatMs(run.completedAt - run.startedAt)}`;
	head.append(question, meta);
	section.appendChild(head);
	if (run.errorMessage) {
		const error = document.createElement("div");
		error.className = "error-line";
		error.textContent = run.errorMessage;
		section.appendChild(error);
	}
	for (const turn of run.turns) section.appendChild(renderTrajectoryTurn(turn, cumulative));
	return section;
}

function renderTrajectory(runs) {
	trajectoryEl.innerHTML = "";
	if (!runs.length) {
		const empty = document.createElement("div");
		empty.className = "trajectory-empty";
		empty.textContent = "暂无运行记录：发起一次提问后，这里会展示每一轮老师的决策、工具调用与耗时。";
		trajectoryEl.appendChild(empty);
		return;
	}
	const cumulative = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 };
	for (const run of runs) trajectoryEl.appendChild(renderTrajectoryRun(run, cumulative));
}

async function loadTrajectory() {
	if (!sessionId) return;
	trajectoryEl.innerHTML = '<div class="trajectory-empty">加载轨迹…</div>';
	try {
		const resp = await fetch(`/api/trajectory?id=${encodeURIComponent(sessionId)}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = await resp.json();
		renderTrajectory(data.runs ?? []);
	} catch {
		trajectoryEl.innerHTML = '<div class="trajectory-empty">轨迹加载失败</div>';
	}
}

function setView(mode) {
	viewMode = mode;
	chatTab.classList.toggle("active", mode === "chat");
	chatTab.setAttribute("aria-selected", String(mode === "chat"));
	trajTab.classList.toggle("active", mode === "trajectory");
	trajTab.setAttribute("aria-selected", String(mode === "trajectory"));
	messagesEl.classList.toggle("hidden", mode !== "chat");
	trajectoryEl.classList.toggle("hidden", mode !== "trajectory");
	composerEl.classList.toggle("hidden", mode !== "chat");
	if (mode === "trajectory") void loadTrajectory();
}

chatTab.onclick = () => setView("chat");
trajTab.onclick = () => setView("trajectory");

/* 扩展名 → 高亮语言（复用聊天气泡里的 highlightCode） */
const EXT_LANG = {
	py: "python",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	ts: "javascript",
	tsx: "javascript",
	json: "json",
	html: "html",
	htm: "html",
	xml: "html",
	css: "css",
	sql: "sql",
	sh: "bash",
	bash: "bash",
};

function langOfPath(p) {
	const ext = p.split(".").pop()?.toLowerCase() ?? "";
	return EXT_LANG[ext] ?? "";
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// 非安全上下文（http 远程访问）的兜底
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	}
}

/* 编辑器式文件项：点击行原地展开内容（手风琴，同时只展开一个） */
function renderFileItem(f) {
	const li = document.createElement("li");
	li.className = "file-item";
	li.innerHTML = `
		<div class="file-item-head">
			<span class="file-caret">▸</span>
			<span class="file-path"></span>
			<button class="copy-btn view-btn" type="button" title="弹窗查看">⛶</button>
			<button class="copy-btn" type="button">复制</button>
		</div>
		<div class="file-item-body"><pre class="file-view-body"><code></code></pre></div>`;
	li.querySelector(".file-path").textContent = f.path;
	const caret = li.querySelector(".file-caret");
	const code = li.querySelector("code");
	const copyButton = li.querySelector(".copy-btn:not(.view-btn)");
	li.querySelector(".view-btn").onclick = (e) => {
		e.stopPropagation();
		openCodeModal(f.path);
	};

	const setExpanded = (on) => {
		li.classList.toggle("expanded", on);
		caret.textContent = on ? "▾" : "▸";
		if (on) code.innerHTML = highlightCode(f.content, langOfPath(f.path));
	};

	li.querySelector(".file-item-head").onclick = () => {
		const opening = !li.classList.contains("expanded");
		fileList.querySelectorAll(".file-item.expanded").forEach((el) => {
			el.classList.remove("expanded");
			el.querySelector(".file-caret").textContent = "▸";
		});
		currentFile = opening ? f : null;
		setExpanded(opening);
	};

	copyButton.onclick = async (e) => {
		e.stopPropagation(); // 不触发展开/收起
		const ok = await copyText(f.content);
		copyButton.textContent = ok ? "已复制 ✓" : "复制失败";
		setTimeout(() => (copyButton.textContent = "复制"), 1500);
	};

	if (currentFile?.path === f.path) {
		currentFile = f; // 刷新后用最新内容覆盖
		setExpanded(true);
	}
	return li;
}

/* 词汇本条目：单词 + 音标/词性，点击展开释义与例句 */
function renderVocabItem(w) {
	const li = document.createElement("li");
	li.className = "vocab-item";
	const head = document.createElement("button");
	head.type = "button";
	head.className = "vocab-item-head";
	head.innerHTML =
		'<span class="vocab-word"></span>' +
		(w.phonetic ? '<span class="vocab-phonetic"></span>' : "") +
		(w.pos ? '<span class="vocab-pos"></span>' : "");
	head.querySelector(".vocab-word").textContent = w.word;
	if (w.phonetic) head.querySelector(".vocab-phonetic").textContent = `/${w.phonetic}/`;
	if (w.pos) head.querySelector(".vocab-pos").textContent = w.pos;
	const body = document.createElement("div");
	body.className = "vocab-item-body";
	body.innerHTML = '<div class="vocab-meaning"></div>' + (w.example ? '<div class="vocab-example"></div>' : "");
	body.querySelector(".vocab-meaning").textContent = w.meaning;
	if (w.example) body.querySelector(".vocab-example").textContent = `例：${w.example}`;
	li.append(head, body);
	head.onclick = () => {
		const opening = !li.classList.contains("expanded");
		fileList.querySelectorAll(".vocab-item.expanded").forEach((el) => el.classList.remove("expanded"));
		li.classList.toggle("expanded", opening);
	};
	return li;
}

/* 学科卡片：类型 + 标题，点击展开摘要、详情与标签。 */
function renderStudyCard(card) {
	const li = document.createElement("li");
	li.className = "vocab-item study-card-item";
	const head = document.createElement("button");
	head.type = "button";
	head.className = "vocab-item-head";
	head.innerHTML = '<span class="vocab-word"></span><span class="vocab-pos"></span>';
	head.querySelector(".vocab-word").textContent = card.title;
	head.querySelector(".vocab-pos").textContent = card.kind;
	const body = document.createElement("div");
	body.className = "vocab-item-body";
	body.innerHTML = '<div class="vocab-meaning"></div>'
		+ (card.details ? '<div class="vocab-example"></div>' : "")
		+ (card.tags?.length ? '<div class="vocab-example study-card-tags"></div>' : "");
	body.querySelector(".vocab-meaning").textContent = card.summary;
	if (card.details) body.querySelector(".vocab-example").textContent = card.details;
	if (card.tags?.length) body.querySelector(".study-card-tags").textContent = `标签：${card.tags.join("、")}`;
	li.append(head, body);
	head.onclick = () => {
		const opening = !li.classList.contains("expanded");
		fileList.querySelectorAll(".vocab-item.expanded").forEach((el) => el.classList.remove("expanded"));
		li.classList.toggle("expanded", opening);
	};
	return li;
}

/* 工作区侧栏按 pack 渲染：代码文件、词汇本或学科学习卡片。 */
async function refreshPanel() {
	if (!sessionId) return;
	try {
		const resp = await fetch(`/api/panel?id=${encodeURIComponent(sessionId)}`);
		const data = await resp.json();
		fileList.innerHTML = "";
		if (data.kind === "files") {
			knownFiles = data.files ?? [];
			if (!modal.classList.contains("hidden")) renderModalFile();
			if (!knownFiles.length) {
				fileList.innerHTML = '<li class="empty">暂无文件</li>';
				currentFile = null;
				return;
			}
			if (currentFile && !knownFiles.some((f) => f.path === currentFile.path)) currentFile = null;
			for (const f of knownFiles) fileList.appendChild(renderFileItem(f));
		} else if (data.kind === "vocabulary") {
			const words = data.words ?? [];
			if (!words.length) {
				fileList.innerHTML = '<li class="empty">暂无生词，让老师教你几个吧</li>';
				return;
			}
			for (const w of words) fileList.appendChild(renderVocabItem(w));
		} else if (data.kind === "study_cards") {
			const cards = data.cards ?? [];
			if (!cards.length) {
				fileList.innerHTML = '<li class="empty">暂无学习卡片，和老师学习后会沉淀在这里</li>';
				return;
			}
			for (const card of cards) fileList.appendChild(renderStudyCard(card));
		}
	} catch {
		/* 侧栏刷新失败不影响对话 */
	}
}

/* ---------- 代码弹窗：循环切换工作区文件，支持全屏 ---------- */
const modal = $("#code-modal");
const modalPanel = modal.querySelector(".modal-panel");
const modalTitle = $("#modal-title");
const modalIndex = $("#modal-index");
const modalCode = $("#modal-code");
const modalCopyBtn = $("#modal-copy");
const modalFullBtn = $("#modal-fullscreen");

let knownFiles = [];
let modalPath = null;

function openCodeModal(path) {
	modalPath = path;
	renderModalFile();
	modal.classList.remove("hidden");
}

function closeCodeModal() {
	modal.classList.add("hidden");
	modalPanel.classList.remove("fullscreen");
	modalFullBtn.textContent = "全屏";
}

function renderModalFile() {
	const pos = knownFiles.findIndex((f) => f.path === modalPath);
	if (pos < 0) {
		closeCodeModal(); // 文件已被删除
		return;
	}
	modalTitle.textContent = knownFiles[pos].path;
	modalIndex.textContent = `${pos + 1} / ${knownFiles.length}`;
	modalCode.innerHTML = highlightCode(knownFiles[pos].content, langOfPath(knownFiles[pos].path));
}

/* 首尾环绕的循环切换 */
function stepModal(delta) {
	const pos = knownFiles.findIndex((f) => f.path === modalPath);
	if (pos < 0 || !knownFiles.length) return;
	modalPath = knownFiles[(pos + delta + knownFiles.length) % knownFiles.length].path;
	renderModalFile();
}

$("#modal-prev").onclick = () => stepModal(-1);
$("#modal-next").onclick = () => stepModal(1);
$("#modal-close").onclick = closeCodeModal;
modal.querySelector(".modal-backdrop").onclick = closeCodeModal;
modalFullBtn.onclick = () => {
	const on = modalPanel.classList.toggle("fullscreen");
	modalFullBtn.textContent = on ? "退出全屏" : "全屏";
};
modalCopyBtn.onclick = async () => {
	const f = knownFiles.find((x) => x.path === modalPath);
	if (!f) return;
	const ok = await copyText(f.content);
	modalCopyBtn.textContent = ok ? "已复制 ✓" : "复制失败";
	setTimeout(() => (modalCopyBtn.textContent = "复制"), 1500);
};

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		if (!modal.classList.contains("hidden")) closeCodeModal();
		else if (document.body.classList.contains("ss-mobile-open")) setMobileSs(false);
		else if (document.body.classList.contains("ws-mobile-open")) setMobileWs(false);
		return;
	}
	if (modal.classList.contains("hidden")) return;
	if (e.key === "ArrowLeft") stepModal(-1);
	else if (e.key === "ArrowRight") stepModal(1);
});

/* 展示名去重：deepseek/deepseek-v4-flash → v4-flash，完整串放 title 悬浮查看 */
function shortModel(m) {
	if (!m) return "";
	const [provider, ...rest] = m.split("/");
	const id = rest.join("/") || m;
	const stripped = id.startsWith(provider + "-") ? id.slice(provider.length + 1) : id;
	return stripped.includes("-") ? stripped : id;
}

async function loadState() {
	if (!sessionId) return;
	try {
		const resp = await fetch(`/api/state?id=${encodeURIComponent(sessionId)}`);
		const state = await resp.json();
		modelInfo.title = state.model ?? "";
		modelNameEl.textContent = shortModel(state.model);
		modelInfo.classList.remove("error");
		currentProfileKey = state.profile?.key ?? null;
		applyPersona(state.profile?.name ?? null);
		// 恢复的会话可能属于其它 pack（浏览器里切换过），同步包选择器
		if (state.pack && state.pack !== currentPack) {
			currentPack = state.pack;
			localStorage.setItem("pilore-pack", currentPack);
			renderPackMenu();
			renderPackChrome();
		}
		if (state.demo) demoBadge.classList.remove("hidden");
		const postgres = state.storage === "postgres";
		storageBadgeEl.textContent = postgres ? "PostgreSQL 持久化" : "内存持久化";
		storageBadgeEl.title = postgres ? "会话已加密存入 PostgreSQL" : "会话仅保存在服务器内存，重启后丢失";
	} catch {
		modelInfo.classList.add("error");
	}
	refreshPanel();
}

/* 按时段问候，降低机械感 */
(function greet() {
	const h = new Date().getHours();
	const hi = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
	const tail = h < 5 ? "慢慢学，别熬太晚" : "今天想学点什么？";
	$("#greeting").textContent = `${hi}，${tail}`;
})();

sendBtn.onclick = () => send();
abortBtn.onclick = () =>
	fetch("/api/abort", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId }),
	});

/* 输入框随内容自动增高；用户拖动拉伸柄后切换为手动固定高度 */
let autoGrowEnabled = true;
let autoGrowHeight = 0;
const INITIAL_TA_HEIGHT = inputEl.offsetHeight;

function autoGrow() {
	if (!autoGrowEnabled) return;
	// border-box：scrollHeight 不含 2px 边框；不低于初始高度避免打字时回缩跳动
	autoGrowHeight = Math.max(INITIAL_TA_HEIGHT, Math.min(inputEl.scrollHeight + 2, window.innerHeight * 0.4));
	inputEl.style.height = `${autoGrowHeight}px`;
}
inputEl.addEventListener("input", () => {
	autoGrow();
	syncChips();
	updateSend();
});

/* 自定义拉伸柄：拖动后固定高度并持久化，双击/ Home 恢复自动增高（原生 resize 已禁用） */
const gripEl = document.querySelector(".resize-grip");
const COMPOSER_H_KEY = "pilore-composer-h";

function setComposerHeight(h) {
	autoGrowEnabled = false;
	inputEl.style.height = `${h}px`;
	gripEl.setAttribute("aria-valuenow", String(h));
	localStorage.setItem(COMPOSER_H_KEY, `${h}px`);
}

function resetComposerHeight() {
	autoGrowEnabled = true;
	inputEl.style.height = "";
	localStorage.removeItem(COMPOSER_H_KEY);
	autoGrow();
}

gripEl.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	gripEl.setPointerCapture(e.pointerId);
	autoGrowEnabled = false;
	gripEl.classList.add("dragging");
	const startY = e.clientY;
	const startH = inputEl.offsetHeight;
	const move = (ev) => {
		const h = Math.max(INITIAL_TA_HEIGHT, Math.min(startH + ev.clientY - startY, window.innerHeight * 0.4));
		inputEl.style.height = `${h}px`;
		gripEl.setAttribute("aria-valuenow", String(Math.round(h)));
	};
	const up = () => {
		gripEl.classList.remove("dragging");
		localStorage.setItem(COMPOSER_H_KEY, inputEl.style.height);
		gripEl.removeEventListener("pointermove", move);
		gripEl.removeEventListener("pointerup", up);
	};
	gripEl.addEventListener("pointermove", move);
	gripEl.addEventListener("pointerup", up);
});

gripEl.addEventListener("dblclick", resetComposerHeight);
gripEl.addEventListener("keydown", (e) => {
	const max = Math.round(window.innerHeight * 0.4);
	const cur = inputEl.offsetHeight;
	if (e.key === "ArrowUp" || e.key === "ArrowDown") {
		setComposerHeight(Math.min(max, Math.max(INITIAL_TA_HEIGHT, cur + (e.key === "ArrowUp" ? 16 : -16))));
	} else if (e.key === "Home") {
		resetComposerHeight();
	} else {
		return;
	}
	e.preventDefault();
});

const savedComposerH = parseInt(localStorage.getItem(COMPOSER_H_KEY), 10);
if (savedComposerH >= INITIAL_TA_HEIGHT) {
	const h = Math.min(savedComposerH, window.innerHeight * 0.4);
	autoGrowEnabled = false;
	inputEl.style.height = `${h}px`;
	gripEl.setAttribute("aria-valuenow", String(Math.round(h)));
}

inputEl.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
});

/* 老师 chips：插入 @mention 前缀，再点同一 chip 取消 */
const MENTION_RE = /^@[a-zA-Z][a-zA-Z0-9_-]*\s+/;
let chips = [];

const mentionInInput = () => {
	const m = inputEl.value.match(/^(@[a-zA-Z][a-zA-Z0-9_-]*)\s/);
	return m ? m[1].toLowerCase() : null;
};

function syncChips() {
	const mention = mentionInInput();
	for (const chip of chips) chip.classList.toggle("active", chip.dataset.mention === mention);
}

function updateSend() {
	sendBtn.disabled = !inputEl.value.trim();
}

function onChipClick(chip) {
	const wasActive = chip.dataset.mention === mentionInInput();
	inputEl.value = inputEl.value.replace(MENTION_RE, "");
	if (!wasActive) inputEl.value = `${chip.dataset.mention} ${inputEl.value}`;
	syncChips();
	updateSend();
	inputEl.focus();
}

resetChip.onclick = async () => {
	try {
		const resp = await fetch("/api/profile", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId, profile: null }),
		});
		if (!resp.ok) return;
		inputEl.value = inputEl.value.replace(MENTION_RE, "");
		currentProfileKey = null;
		applyPersona(null);
		syncChips();
		updateSend();
		const note = document.createElement("div");
		note.className = "system-note";
		note.textContent = "已切回 PiLore 自动路由";
		messagesEl.appendChild(note);
		scrollToBottom();
	} catch {
		/* 忽略 */
	}
};

syncChips();
updateSend();

/* ---------- 工作区面板：折叠 + 拖拽/键盘调宽，偏好存 localStorage ---------- */
const layoutEl = document.querySelector(".layout");
const workspaceEl = document.querySelector(".workspace");
const wsResize = $("#ws-resize");
const wsToggleBtn = $("#ws-toggle");
const wsExpandBtn = $("#ws-expand");

const WS_DEFAULT_W = 300; // 与 CSS var(--ws-w, 300px) 缺省值一致
const WS_MIN_W = 220;
const WS_COLLAPSE_AT = 140; // 拖到该宽度以下松手 → 吸附折叠

let lastGoodWsW = WS_DEFAULT_W;

function wsMaxW() {
	return Math.min(640, Math.round(layoutEl.clientWidth * 0.6));
}

function applyWsWidth(w) {
	layoutEl.style.setProperty("--ws-w", `${w}px`);
	wsResize.setAttribute("aria-valuenow", String(w));
}

function setWsCollapsed(on) {
	layoutEl.classList.toggle("ws-collapsed", on);
	localStorage.setItem("pilore-ws-collapsed", on ? "1" : "");
	wsToggleBtn.setAttribute("aria-expanded", String(!on));
	wsExpandBtn.setAttribute("aria-expanded", String(!on));
}

/* 窄屏抽屉：顶栏按钮唤出工作区覆盖层（恢复路径） */
const mobileMq = window.matchMedia("(max-width: 900px)");
const wsMobileBtn = $("#ws-mobile-toggle");
const wsBackdrop = $("#ws-backdrop");

function setMobileWs(open) {
	document.body.classList.toggle("ws-mobile-open", open);
	wsMobileBtn.setAttribute("aria-expanded", String(open));
}

wsToggleBtn.onclick = () => {
	if (mobileMq.matches) setMobileWs(false); // 窄屏下该按钮负责关闭抽屉
	else setWsCollapsed(true);
};
wsExpandBtn.onclick = () => setWsCollapsed(false);
wsMobileBtn.onclick = () => setMobileWs(!document.body.classList.contains("ws-mobile-open"));
wsBackdrop.onclick = () => setMobileWs(false);
mobileMq.addEventListener("change", () => {
	if (!mobileMq.matches) setMobileWs(false);
	wsToggleBtn.title = mobileMq.matches ? "关闭工作区" : "收起工作区";
});
wsToggleBtn.title = mobileMq.matches ? "关闭工作区" : "收起工作区";

let wsResizing = false;
wsResize.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "mouse" && e.button !== 0) return;
	wsResizing = true;
	wsResize.setPointerCapture(e.pointerId);
	document.body.classList.add("ws-resizing");
	e.preventDefault();
});
wsResize.addEventListener("pointermove", (e) => {
	if (!wsResizing) return;
	// 以 aside 右缘为基准，避免 layout 的 padding 造成偏差
	const right = workspaceEl.getBoundingClientRect().right;
	const w = Math.round(Math.min(wsMaxW(), Math.max(60, right - e.clientX)));
	layoutEl.style.setProperty("--ws-w", `${w}px`);
});
function endWsResize(e) {
	if (!wsResizing) return;
	wsResizing = false;
	document.body.classList.remove("ws-resizing");
	try {
		wsResize.releasePointerCapture(e.pointerId);
	} catch {
		/* pointercancel 时捕获可能已失效 */
	}
	const w = parseInt(layoutEl.style.getPropertyValue("--ws-w"), 10) || WS_DEFAULT_W;
	if (w < WS_COLLAPSE_AT) {
		applyWsWidth(lastGoodWsW); // 拖拽折叠时保留原宽度，展开即恢复
		setWsCollapsed(true);
	} else {
		lastGoodWsW = Math.min(wsMaxW(), Math.max(WS_MIN_W, w));
		applyWsWidth(lastGoodWsW);
		localStorage.setItem("pilore-ws-w", `${lastGoodWsW}px`);
	}
}
wsResize.addEventListener("pointerup", endWsResize);
wsResize.addEventListener("pointercancel", endWsResize);

wsResize.addEventListener("dblclick", () => {
	lastGoodWsW = WS_DEFAULT_W;
	applyWsWidth(WS_DEFAULT_W);
	localStorage.removeItem("pilore-ws-w");
});

wsResize.addEventListener("keydown", (e) => {
	const cur = Math.round(workspaceEl.getBoundingClientRect().width);
	const step = 24;
	if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		const w = Math.min(wsMaxW(), Math.max(WS_MIN_W, cur + (e.key === "ArrowLeft" ? step : -step)));
		lastGoodWsW = w;
		applyWsWidth(w);
		localStorage.setItem("pilore-ws-w", `${w}px`);
	} else if (e.key === "Home") {
		lastGoodWsW = WS_DEFAULT_W;
		applyWsWidth(WS_DEFAULT_W);
		localStorage.removeItem("pilore-ws-w");
	} else if (e.key === "Enter" || e.key === " ") {
		setWsCollapsed(true);
		wsExpandBtn.focus(); // 焦点移交到展开按钮，键盘可恢复
	} else {
		return;
	}
	e.preventDefault();
});

if (localStorage.getItem("pilore-ws-collapsed") === "1") setWsCollapsed(true);
const savedWsW = parseInt(localStorage.getItem("pilore-ws-w"), 10);
if (savedWsW >= WS_MIN_W) {
	lastGoodWsW = Math.min(640, savedWsW);
	applyWsWidth(lastGoodWsW);
}
wsResize.setAttribute("aria-valuemax", String(wsMaxW()));

/* ---------- 会话侧边栏：历史列表 / 切换 / 新建 / 删除 ---------- */
const sessionsEl = document.querySelector(".sessions");
const ssResize = $("#ss-resize");
const ssToggleBtn = $("#ss-toggle");
const ssRailBtn = $("#ss-rail");

let sessionId = null;
let sessionsCache = [];

function relTime(value) {
	const diff = Date.now() - new Date(value).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const d = new Date(value);
	return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function renderSessionList() {
	sessionListEl.innerHTML = "";
	if (!sessionsCache.length) {
		sessionListEl.innerHTML = '<li class="empty">暂无会话</li>';
		return;
	}
	for (const s of sessionsCache) {
		const title = s.title || "新会话";
		const li = document.createElement("li");
		li.className = s.id === sessionId ? "session-item active" : "session-item";
		const main = document.createElement("button");
		main.type = "button";
		main.className = "session-item-main";
		main.innerHTML = '<span class="session-title"></span><span class="session-time"></span>';
		main.querySelector(".session-title").textContent = title;
		main.querySelector(".session-time").textContent = relTime(s.updatedAt);
		main.onclick = () => switchSession(s.id);
		const del = document.createElement("button");
		del.type = "button";
		del.className = "icon-btn session-del";
		del.title = "删除会话";
		del.setAttribute("aria-label", `删除会话：${title}`);
		del.textContent = "✕";
		del.onclick = async () => {
			if (!window.confirm(`删除会话「${title}」？此操作不可恢复。`)) return;
			try {
				await fetch(`/api/sessions?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
			} catch {
				return;
			}
			const wasCurrent = s.id === sessionId;
			await refreshSessionList();
			if (wasCurrent) {
				if (sessionsCache.length) await switchSession(sessionsCache[0].id);
				else await newSession();
			}
		};
		li.append(main, del);
		sessionListEl.appendChild(li);
	}
}

async function refreshSessionList() {
	try {
		const resp = await fetch(`/api/sessions?pack=${encodeURIComponent(currentPack)}`);
		const data = await resp.json();
		sessionsCache = data.sessions ?? [];
	} catch {
		sessionsCache = [];
	}
	renderSessionList();
	return sessionsCache;
}

async function createSessionOnServer() {
	const resp = await fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ pack: currentPack }),
	});
	const data = await resp.json();
	return data.sessionId;
}

/* 启动/删除后保证存在当前会话：优先上次打开的，其次最新的，否则新建 */
async function ensureSession() {
	const sessions = await refreshSessionList();
	const key = `pilore-session-id:${currentPack}`;
	const saved = localStorage.getItem(key);
	if (saved && sessions.some((s) => s.id === saved)) sessionId = saved;
	else if (!sessionId || !sessions.some((s) => s.id === sessionId)) sessionId = sessions[0]?.id ?? (await createSessionOnServer());
	localStorage.setItem(key, sessionId);
	renderSessionList();
}

function clearMessagesView() {
	messagesEl.innerHTML = "";
}

/* 渲染历史消息；有内容时移除欢迎卡。返回是否恢复了消息。 */
async function renderHistory() {
	try {
		const resp = await fetch(`/api/sessions/history?id=${encodeURIComponent(sessionId)}`);
		if (!resp.ok) return false;
		const { messages } = await resp.json();
		if (!messages.length) return false;
		clearMessagesView();
		for (const m of messages) {
			if (m.role === "user") {
				const el = document.createElement("div");
				el.className = "msg-user";
				el.textContent = m.text;
				messagesEl.appendChild(el);
			} else {
				const card = document.createElement("div");
				card.className = "msg-assistant card";
				const text = document.createElement("div");
				text.className = "msg-text";
				renderMathMarkdown(text, m.text);
				card.appendChild(text);
				messagesEl.appendChild(card);
			}
		}
		scrollToBottom();
		return true;
	} catch {
		return false;
	}
}

async function enterSession(id) {
	sessionId = id;
	localStorage.setItem(`pilore-session-id:${currentPack}`, id);
	clearMessagesView();
	const restored = await renderHistory();
	if (!restored && welcomeEl) messagesEl.appendChild(welcomeEl);
	await loadState();
	if (viewMode === "trajectory") void loadTrajectory();
	renderSessionList();
}

async function switchSession(id) {
	if (id === sessionId) return;
	if (busy) {
		const note = document.createElement("div");
		note.className = "system-note";
		note.textContent = "正在生成回复，暂时无法切换会话";
		messagesEl.appendChild(note);
		scrollToBottom();
		return;
	}
	await enterSession(id);
}

async function newSession() {
	if (busy) return;
	const id = await createSessionOnServer();
	await enterSession(id);
	await refreshSessionList();
	inputEl.focus();
}

$("#ss-new").onclick = newSession;

/* 折叠 + 拖拽/键盘调宽（镜像右侧工作区的交互约定），偏好存 localStorage */
const SS_DEFAULT_W = 240; // 与 CSS var(--ss-w, 240px) 缺省值一致
const SS_MIN_W = 180;
const SS_COLLAPSE_AT = 140;

let lastGoodSsW = SS_DEFAULT_W;

function ssMaxW() {
	return Math.min(420, Math.round(layoutEl.clientWidth * 0.45));
}

function applySsWidth(w) {
	layoutEl.style.setProperty("--ss-w", `${w}px`);
	ssResize.setAttribute("aria-valuenow", String(w));
}

function setSsCollapsed(on) {
	layoutEl.classList.toggle("ss-collapsed", on);
	localStorage.setItem("pilore-ss-collapsed", on ? "1" : "");
	ssToggleBtn.setAttribute("aria-expanded", String(!on));
	ssRailBtn.setAttribute("aria-expanded", String(!on));
}

/* 窄屏抽屉：顶栏按钮唤出会话历史（左侧覆盖层） */
const ssMobileBtn = $("#ss-mobile-toggle");
const ssBackdrop = $("#ss-backdrop");

function setMobileSs(open) {
	document.body.classList.toggle("ss-mobile-open", open);
	ssMobileBtn.setAttribute("aria-expanded", String(open));
}

ssToggleBtn.onclick = () => {
	if (mobileMq.matches) setMobileSs(false); // 窄屏下该按钮负责关闭抽屉
	else setSsCollapsed(true);
};
ssRailBtn.onclick = () => setSsCollapsed(false);
ssMobileBtn.onclick = () => setMobileSs(!document.body.classList.contains("ss-mobile-open"));
ssBackdrop.onclick = () => setMobileSs(false);
mobileMq.addEventListener("change", () => {
	if (!mobileMq.matches) setMobileSs(false);
	ssToggleBtn.title = mobileMq.matches ? "关闭会话历史" : "收起会话历史";
});
ssToggleBtn.title = mobileMq.matches ? "关闭会话历史" : "收起会话历史";

let ssResizing = false;
ssResize.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "mouse" && e.button !== 0) return;
	ssResizing = true;
	ssResize.setPointerCapture(e.pointerId);
	document.body.classList.add("ss-resizing");
	e.preventDefault();
});
ssResize.addEventListener("pointermove", (e) => {
	if (!ssResizing) return;
	// 以 nav 左缘为基准，向右拖增宽
	const left = sessionsEl.getBoundingClientRect().left;
	const w = Math.round(Math.min(ssMaxW(), Math.max(60, e.clientX - left)));
	layoutEl.style.setProperty("--ss-w", `${w}px`);
});
function endSsResize(e) {
	if (!ssResizing) return;
	ssResizing = false;
	document.body.classList.remove("ss-resizing");
	try {
		ssResize.releasePointerCapture(e.pointerId);
	} catch {
		/* pointercancel 时捕获可能已失效 */
	}
	const w = parseInt(layoutEl.style.getPropertyValue("--ss-w"), 10) || SS_DEFAULT_W;
	if (w < SS_COLLAPSE_AT) {
		applySsWidth(lastGoodSsW); // 拖拽折叠时保留原宽度，展开即恢复
		setSsCollapsed(true);
	} else {
		lastGoodSsW = Math.min(ssMaxW(), Math.max(SS_MIN_W, w));
		applySsWidth(lastGoodSsW);
		localStorage.setItem("pilore-ss-w", `${lastGoodSsW}px`);
	}
}
ssResize.addEventListener("pointerup", endSsResize);
ssResize.addEventListener("pointercancel", endSsResize);

ssResize.addEventListener("dblclick", () => {
	lastGoodSsW = SS_DEFAULT_W;
	applySsWidth(SS_DEFAULT_W);
	localStorage.removeItem("pilore-ss-w");
});

ssResize.addEventListener("keydown", (e) => {
	const cur = Math.round(sessionsEl.getBoundingClientRect().width);
	const step = 24;
	if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
		// 左面板：ArrowRight 增宽（与工作区方向相反）
		const w = Math.min(ssMaxW(), Math.max(SS_MIN_W, cur + (e.key === "ArrowRight" ? step : -step)));
		lastGoodSsW = w;
		applySsWidth(w);
		localStorage.setItem("pilore-ss-w", `${w}px`);
	} else if (e.key === "Home") {
		lastGoodSsW = SS_DEFAULT_W;
		applySsWidth(SS_DEFAULT_W);
		localStorage.removeItem("pilore-ss-w");
	} else if (e.key === "Enter" || e.key === " ") {
		setSsCollapsed(true);
		ssRailBtn.focus();
	} else {
		return;
	}
	e.preventDefault();
});

if (localStorage.getItem("pilore-ss-collapsed") === "1") setSsCollapsed(true);
const savedSsW = parseInt(localStorage.getItem("pilore-ss-w"), 10);
if (savedSsW >= SS_MIN_W) {
	lastGoodSsW = Math.min(420, savedSsW);
	applySsWidth(lastGoodSsW);
}
ssResize.setAttribute("aria-valuemax", String(ssMaxW()));

/* ---------- 学习包：目录加载 / 欢迎语与 chips 动态渲染 / 切换 ---------- */

function packInfo() {
	return packs.find((p) => p.id === currentPack);
}

/* 按当前 pack 重绘欢迎卡片、老师 chips 与工作区标题 */
function renderPackChrome() {
	const pack = packInfo();
	if (!pack) return;
	welcomeTitle.textContent = `${pack.name} · 开始学习`;
	welcomeDesc.textContent = pack.tagline;
	suggestionsEl.innerHTML = "";
	for (const text of pack.suggestions) {
		const btn = document.createElement("button");
		btn.className = "suggestion";
		btn.textContent = text;
		btn.onclick = () => send(btn.textContent);
		suggestionsEl.appendChild(btn);
	}
	chipsEl.innerHTML = "";
	for (const profile of pack.profiles) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "chip";
		btn.dataset.mention = `@${profile.key}`;
		btn.innerHTML = '<span class="chip-dot"></span><span></span>';
		btn.querySelector("span:last-child").textContent = profile.name;
		btn.onclick = () => onChipClick(btn);
		chipsEl.appendChild(btn);
	}
	chips = [...chipsEl.querySelectorAll(".chip[data-mention]")];
	wsTitle.textContent = pack.panelTitle ?? "学习资料";
}

async function loadPacks() {
	try {
		const resp = await fetch("/api/packs");
		const data = await resp.json();
		packs = data.packs ?? [];
	} catch {
		packs = [];
	}
	const saved = localStorage.getItem("pilore-pack");
	currentPack = saved && packs.some((p) => p.id === saved) ? saved : (packs[0]?.id ?? "code");
	renderPackMenu();
}

function packIcon(pack) {
	if (pack.id === "english") return "A";
	if (pack.id === "math") return "π";
	if (pack.id === "physics") return "Φ";
	if (pack.id === "history") return "史";
	return "&lt;/&gt;";
}

function renderPackMenu() {
	const current = packInfo();
	packCurrentEl.textContent = current?.name ?? "学习包";
	packOptionsEl.innerHTML = "";
	for (const pack of packs) {
		const option = document.createElement("button");
		const selected = pack.id === currentPack;
		option.type = "button";
		option.className = selected ? "pack-option active" : "pack-option";
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", String(selected));
		option.innerHTML = `<span class="pack-option-icon">${packIcon(pack)}</span><span><strong></strong><small></small></span>`;
		option.querySelector("strong").textContent = pack.name;
		option.querySelector("small").textContent = pack.tagline;
		option.onclick = () => switchPack(pack.id);
		packOptionsEl.appendChild(option);
	}
}

async function switchPack(newPack) {
	if (newPack === currentPack) {
		closePackMenu();
		return;
	}
	if (busy) {
		const note = document.createElement("div");
		note.className = "system-note";
		note.textContent = "正在生成回复，暂时无法切换学习包";
		messagesEl.appendChild(note);
		scrollToBottom();
		return;
	}
	currentPack = newPack;
	localStorage.setItem("pilore-pack", newPack);
	renderPackMenu();
	closePackMenu();
	applyPersona(null);
	currentProfileKey = null;
	currentFile = null;
	renderPackChrome();
	await ensureSession();
	await enterSession(sessionId);
	await refreshSessionList();
}

function closePackMenu() {
	packSelect.setAttribute("aria-expanded", "false");
	packOptionsEl.classList.add("hidden");
}

packSelect.onclick = () => {
	const expanded = packSelect.getAttribute("aria-expanded") === "true";
	packSelect.setAttribute("aria-expanded", String(!expanded));
	packOptionsEl.classList.toggle("hidden", expanded);
};

document.addEventListener("click", (event) => {
	if (!event.target.closest(".pack-menu")) closePackMenu();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closePackMenu();
});

(async function init() {
	await loadPacks();
	renderPackChrome();
	await ensureSession();
	await renderHistory();
	await loadState();
})();
