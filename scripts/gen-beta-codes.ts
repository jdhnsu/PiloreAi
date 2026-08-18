import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 生成内测邀请码注册表：为每个用户生成一个高熵邀请码，
 * 以 { userId, codeHash(sha256 hex) } 写入 data/beta-users.json（已 gitignore），
 * 明文邀请码只在本次输出打印一次，供分发给用户。
 *
 * 用法: npm run gen:beta-codes [count] [prefix]
 *   count  用户数量，默认 15
 *   prefix userId 前缀，默认 beta（生成 beta-01…beta-15）
 */

const count = Number(process.argv[2] ?? 15);
const prefix = process.argv[3] ?? "beta";
// 去除易混淆字符（0/O/1/I/L）的大写字母数字表
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

if (!Number.isInteger(count) || count <= 0 || count > 1000) {
	console.error("count 需为 1-1000 的整数");
	process.exit(1);
}

function randomCode(): string {
	const bytes = randomBytes(12);
	const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
	// 12 字符分三段，便于抄写
	return `pil-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data");
const outFile = path.join(outDir, "beta-users.json");

await mkdir(outDir, { recursive: true });

// 若已有注册表则合并，保留既有用户的码不重新生成（避免已分发的码失效）
interface RegistryUser {
	userId: string;
	codeHash: string;
}
let existing: RegistryUser[] = [];
try {
	const parsed = JSON.parse(await readFile(outFile, "utf8")) as { users?: RegistryUser[] };
	existing = Array.isArray(parsed.users) ? parsed.users : [];
} catch {
	/* 首次生成，忽略 */
}

const padWidth = String(count).length;
const issued: Array<{ userId: string; code: string }> = [];
const users = [...existing];
for (let i = 1; i <= count; i += 1) {
	const userId = `${prefix}-${String(i).padStart(padWidth, "0")}`;
	if (users.some((u) => u.userId === userId)) continue;
	const code = randomCode();
	// 与登录侧一致：验证前会把输入统一转大写，哈希必须基于大写形式
	users.push({ userId, codeHash: sha256Hex(code.toUpperCase()) });
	issued.push({ userId, code });
}

await writeFile(outFile, `${JSON.stringify({ users }, null, 2)}\n`, "utf8");

console.log(`注册表: ${outFile}（共 ${users.length} 个用户）`);
if (issued.length === 0) {
	console.log("没有新增用户；所有 userId 已存在于注册表。");
} else {
	console.log(`\n新邀请码（只显示这一次，请妥善保管并分发）：`);
	for (const { userId, code } of issued) {
		console.log(`  ${userId.padEnd(10)} ${code}`);
	}
	console.log("\n登录时用邀请码即可；userId 会自动映射。吊销用户 = 从注册表删除对应行并重启。");
}
