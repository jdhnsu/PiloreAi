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

let busy = false;
let currentPersona = null; // 当前老师名；null = PiLore 自动路由
let currentFile = null; // 工作区当前展开的文件 { path, content }

const TOOL_GLYPHS = { write_file: "✎", read_file: "≡", run_code: "▶" };
const TOOL_LABELS = { write_file: "写入", read_file: "读取", run_code: "运行", adopt_persona: "切换老师" };

function esc(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

function scrollToBottom() {
	messagesEl.scrollTop = messagesEl.scrollHeight;
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
			el.innerHTML = renderMarkdown(block.textBuf);
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
			closeTextSegment(block);
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
			body: JSON.stringify({ message }),
		});
		if (!resp.ok || !resp.body) {
			const info = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
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
		refreshFiles();
	}
}

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

async function refreshFiles() {
	try {
		const resp = await fetch("/api/files");
		const { files } = await resp.json();
		knownFiles = files;
		if (!modal.classList.contains("hidden")) renderModalFile();
		fileList.innerHTML = "";
		if (!files.length) {
			fileList.innerHTML = '<li class="empty">暂无文件</li>';
			currentFile = null;
			return;
		}
		if (currentFile && !files.some((f) => f.path === currentFile.path)) currentFile = null;
		for (const f of files) fileList.appendChild(renderFileItem(f));
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
	if (modal.classList.contains("hidden")) return;
	if (e.key === "Escape") closeCodeModal();
	else if (e.key === "ArrowLeft") stepModal(-1);
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
	try {
		const resp = await fetch("/api/state");
		const state = await resp.json();
		modelInfo.title = state.model ?? "";
		modelNameEl.textContent = shortModel(state.model);
		modelInfo.classList.remove("error");
		applyPersona(state.persona?.name ?? null);
		if (state.demo) demoBadge.classList.remove("hidden");
	} catch {
		modelInfo.classList.add("error");
	}
	refreshFiles();
}

/* 按时段问候，降低机械感 */
(function greet() {
	const h = new Date().getHours();
	const hi = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
	const tail = h < 5 ? "慢慢学，别熬太晚" : "今天想学点什么？";
	$("#greeting").textContent = `${hi}，${tail}`;
})();

sendBtn.onclick = () => send();
abortBtn.onclick = () => fetch("/api/abort", { method: "POST" });

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

/* 自定义拉伸柄：拖动后固定高度（原生 resize 已禁用） */
const gripEl = document.querySelector(".resize-grip");
gripEl.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	autoGrowEnabled = false;
	gripEl.classList.add("dragging");
	const startY = e.clientY;
	const startH = inputEl.offsetHeight;
	const move = (ev) => {
		inputEl.style.height = `${Math.max(INITIAL_TA_HEIGHT, Math.min(startH + ev.clientY - startY, window.innerHeight * 0.4))}px`;
	};
	const up = () => {
		gripEl.classList.remove("dragging");
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
});

inputEl.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
});

document.querySelectorAll(".suggestion").forEach((btn) => {
	btn.onclick = () => send(btn.textContent);
});

/* 老师 chips：插入 @mention 前缀，再点同一 chip 取消 */
const MENTION_RE = /^@[a-zA-Z][a-zA-Z0-9_-]*\s+/;
const chips = [...document.querySelectorAll(".chip[data-mention]")];

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

chips.forEach((chip) => {
	chip.onclick = () => {
		const wasActive = chip.dataset.mention === mentionInInput();
		inputEl.value = inputEl.value.replace(MENTION_RE, "");
		if (!wasActive) inputEl.value = `${chip.dataset.mention} ${inputEl.value}`;
		syncChips();
		updateSend();
		inputEl.focus();
	};
});

resetChip.onclick = async () => {
	try {
		const resp = await fetch("/api/persona", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ persona: null }),
		});
		if (!resp.ok) return;
		inputEl.value = inputEl.value.replace(MENTION_RE, "");
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

/* ---------- 工作区面板：折叠 + 拖拽调宽，偏好存 localStorage ---------- */
const layoutEl = document.querySelector(".layout");
const wsResize = $("#ws-resize");

function setWsCollapsed(on) {
	layoutEl.classList.toggle("ws-collapsed", on);
	localStorage.setItem("pilore-ws-collapsed", on ? "1" : "");
}

$("#ws-toggle").onclick = () => setWsCollapsed(true);
$("#ws-expand").onclick = () => setWsCollapsed(false);

let wsResizing = false;
wsResize.addEventListener("mousedown", (e) => {
	wsResizing = true;
	document.body.classList.add("ws-resizing");
	e.preventDefault();
});
document.addEventListener("mousemove", (e) => {
	if (!wsResizing) return;
	// 以 aside 右缘为基准，避免 layout 的 padding 造成偏差
	const right = document.querySelector(".workspace").getBoundingClientRect().right;
	const w = Math.round(Math.min(520, Math.max(220, right - e.clientX)));
	layoutEl.style.setProperty("--ws-w", `${w}px`);
});
document.addEventListener("mouseup", () => {
	if (!wsResizing) return;
	wsResizing = false;
	document.body.classList.remove("ws-resizing");
	localStorage.setItem("pilore-ws-w", layoutEl.style.getPropertyValue("--ws-w"));
});
wsResize.addEventListener("dblclick", () => {
	layoutEl.style.removeProperty("--ws-w");
	localStorage.removeItem("pilore-ws-w");
});

if (localStorage.getItem("pilore-ws-collapsed") === "1") setWsCollapsed(true);
const savedWsW = localStorage.getItem("pilore-ws-w");
if (savedWsW) layoutEl.style.setProperty("--ws-w", savedWsW);

loadState();
