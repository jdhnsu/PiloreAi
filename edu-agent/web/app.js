"use strict";

const $ = (sel) => document.querySelector(sel);
const messagesEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send");
const abortBtn = $("#abort");
const personaBadge = $("#persona-badge");
const demoBadge = $("#demo-badge");
const modelInfo = $("#model-info");
const fileList = $("#file-list");
const fileView = $("#file-view");
const resetChip = $("#reset-persona");

let busy = false;
let currentPersona = null; // 当前老师名；null = PiLore 自动路由

const TOOL_GLYPHS = { write_file: "✎", read_file: "≡", run_code: "▶" };
const TOOL_LABELS = { write_file: "写入", read_file: "读取", run_code: "运行", adopt_persona: "切换老师" };

function esc(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 极简 markdown：代码块/行内代码/加粗/标题/列表，先转义再套标签 */
function renderMarkdown(src) {
	const parts = src.split("```");
	let html = "";
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			const nl = parts[i].indexOf("\n");
			const code = (nl >= 0 ? parts[i].slice(nl + 1) : parts[i]).replace(/\n$/, "");
			html += `<pre><code>${esc(code)}</code></pre>`;
		} else {
			html += renderLines(parts[i]);
		}
	}
	return html;
}

function renderLines(text) {
	const out = [];
	for (const raw of text.split("\n")) {
		let line = esc(raw);
		line = line.replace(/`([^`]+)`/g, "<code>$1</code>");
		line = line.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
		const h = line.match(/^(#{1,3})\s+(.*)$/);
		if (h) {
			out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`);
		} else if (/^\s*[-*]\s+/.test(line)) {
			out.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
		} else if (/^\s*\d+[.)]\s+/.test(line)) {
			out.push(`<li>${line.replace(/^\s*\d+[.)]\s+/, "")}</li>`);
		} else if (line.trim() === "") {
			out.push("");
		} else {
			out.push(`<p>${line}</p>`);
		}
	}
	return out.join("");
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
	personaBadge.textContent = `老师 · ${name}`;
	personaBadge.classList.remove("hidden");
}

function applyPersona(name) {
	currentPersona = name ?? null;
	setPersonaBadge(name);
	resetChip.classList.toggle("hidden", !name);
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
	sendBtn.disabled = value;
	sendBtn.classList.toggle("hidden", value);
	abortBtn.classList.toggle("hidden", !value);
	inputEl.disabled = false;
}

async function send(text) {
	const message = (text ?? inputEl.value).trim();
	if (!message || busy) return;
	inputEl.value = "";

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

async function refreshFiles() {
	try {
		const resp = await fetch("/api/files");
		const { files } = await resp.json();
		fileList.innerHTML = "";
		if (!files.length) {
			fileList.innerHTML = '<li class="empty">暂无文件</li>';
			fileView.classList.add("hidden");
			return;
		}
		for (const f of files) {
			const li = document.createElement("li");
			li.className = "file-item";
			li.textContent = f.path;
			li.onclick = () => {
				fileList.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
				li.classList.add("active");
				fileView.textContent = f.content;
				fileView.classList.remove("hidden");
			};
			fileList.appendChild(li);
		}
	} catch {
		/* 侧栏刷新失败不影响对话 */
	}
}

async function loadState() {
	try {
		const resp = await fetch("/api/state");
		const state = await resp.json();
		modelInfo.textContent = state.model ?? "";
		applyPersona(state.persona?.name ?? null);
		if (state.demo) demoBadge.classList.remove("hidden");
	} catch {
		/* 忽略 */
	}
	refreshFiles();
}

sendBtn.onclick = () => send();
abortBtn.onclick = () => fetch("/api/abort", { method: "POST" });

inputEl.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
});

document.querySelectorAll(".suggestion").forEach((btn) => {
	btn.onclick = () => send(btn.textContent);
});

document.querySelectorAll(".chip[data-mention]").forEach((chip) => {
	chip.onclick = () => {
		const mention = `${chip.dataset.mention} `;
		inputEl.value = inputEl.value.replace(/^@[a-zA-Z][a-zA-Z0-9_-]*\s+/, "");
		inputEl.value = mention + inputEl.value;
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
		applyPersona(null);
		const note = document.createElement("div");
		note.className = "system-note";
		note.textContent = "已切回 PiLore 自动路由";
		messagesEl.appendChild(note);
		scrollToBottom();
	} catch {
		/* 忽略 */
	}
};

loadState();
