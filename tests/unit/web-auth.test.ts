import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	BetaAuth,
	generateAuthSecret,
	hashPassword,
	inviteCodeHash,
	normalizeEmail,
	parseCookies,
	resolveAuthSecret,
	verifyPassword,
} from "../../src/adapters/web/auth.js";

const secret = Buffer.from(generateAuthSecret(), "hex");

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function withRegistry(users: Array<{ userId: string; code: string }>, fn: (auth: BetaAuth, registryPath: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), "pilore-auth-"));
	const registryPath = path.join(dir, "beta-users.json");
	const registry = { users: users.map(({ userId, code }) => ({ userId, codeHash: sha256Hex(code.toUpperCase()) })) };
	await writeFile(registryPath, JSON.stringify(registry), "utf8");
	try {
		await fn(new BetaAuth({ registryPath, secret }), registryPath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("邀请码校验：正确码映射 userId 与哈希，大小写与空白容错，错误码拒绝", async () => {
	await withRegistry([{ userId: "beta-01", code: "PIL-ABCD-EFGH-JKMN" }], async (auth) => {
		const expected = { userId: "beta-01", codeHash: inviteCodeHash("PIL-ABCD-EFGH-JKMN") };
		assert.deepEqual(await auth.authenticate("PIL-ABCD-EFGH-JKMN"), expected);
		assert.deepEqual(await auth.authenticate("  pil-abcd-efgh-jkmn "), expected);
		assert.equal(await auth.authenticate("PIL-XXXX-XXXX-XXXX"), undefined);
		assert.equal(await auth.authenticate(""), undefined);
	});
});

test("注册表热重载：删除用户行后该邀请码立即失效", async () => {
	await withRegistry(
		[
			{ userId: "beta-01", code: "PIL-AAAA-BBBB-CCCC" },
			{ userId: "beta-02", code: "PIL-DDDD-EEEE-FFFF" },
		],
		async (auth, registryPath) => {
			assert.equal((await auth.authenticate("PIL-AAAA-BBBB-CCCC"))?.userId, "beta-01");
			const revoked = { users: [{ userId: "beta-02", codeHash: sha256Hex("PIL-DDDD-EEEE-FFFF") }] };
			await writeFile(registryPath, JSON.stringify(revoked), "utf8");
			assert.equal(await auth.authenticate("PIL-AAAA-BBBB-CCCC"), undefined);
			assert.equal((await auth.authenticate("PIL-DDDD-EEEE-FFFF"))?.userId, "beta-02");
		},
	);
});

test("注册表忽略非法条目（userId/哈希格式不合法）", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "pilore-auth-"));
	const registryPath = path.join(dir, "beta-users.json");
	const registry = {
		users: [
			{ userId: "ok-1", codeHash: sha256Hex("PIL-OKOK-OKOK-OKOK") },
			{ userId: "bad user!", codeHash: sha256Hex("PIL-BAD1") },
			{ userId: "bad-hash", codeHash: "not-a-hash" },
		],
	};
	await writeFile(registryPath, JSON.stringify(registry), "utf8");
	try {
		const auth = new BetaAuth({ registryPath, secret });
		assert.equal((await auth.authenticate("PIL-OKOK-OKOK-OKOK"))?.userId, "ok-1");
		assert.equal(await auth.authenticate("PIL-BAD1"), undefined);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Cookie 签发与校验：往返成功，篡改与过期拒绝", () => {
	const auth = new BetaAuth({ registryPath: "unused", secret, maxAgeMs: 60_000 });
	const now = 1_000_000;
	const value = auth.issueCookieValue("beta-07", now);
	assert.deepEqual(auth.verifyCookieValue(value, now + 1), { userId: "beta-07" });
	assert.equal(auth.verifyCookieValue(value, now + 61_000), undefined, "过期后拒绝");
	const tampered = value.replace("beta-07", "beta-08");
	assert.equal(auth.verifyCookieValue(tampered, now + 1), undefined, "篡改 userId 拒绝");
	const [head, sig] = [value.slice(0, value.lastIndexOf(".")), value.slice(value.lastIndexOf(".") + 1)];
	const flipped = `${head}.${sig.replace(/^./, (c) => (c === "0" ? "1" : "0"))}`;
	assert.equal(auth.verifyCookieValue(flipped, now + 1), undefined, "篡改签名拒绝");
	assert.equal(auth.verifyCookieValue("v1.beta-07.abc.sig", now), undefined, "格式异常拒绝");
	assert.equal(auth.verifyCookieValue(undefined, now), undefined);
});

test("Cookie 头解析：多 Cookie 中取出目标并校验", () => {
	const auth = new BetaAuth({ registryPath: "unused", secret });
	const now = Date.now();
	const value = auth.issueCookieValue("beta-03", now);
	const header = `theme=dark; ${auth.cookieName}=${encodeURIComponent(value)}; other=1`;
	assert.deepEqual(auth.verifyCookieHeader(header, now + 1), { userId: "beta-03" });
	assert.equal(auth.verifyCookieHeader("theme=dark", now + 1), undefined);
	assert.equal(auth.verifyCookieHeader(undefined, now + 1), undefined);
});

test("authCookieHeader 包含安全属性，secure 时附加 Secure", () => {
	const auth = new BetaAuth({ registryPath: "unused", secret });
	const plain = auth.authCookieHeader("beta-01", false);
	assert.match(plain, /^pilore_auth=/);
	assert.match(plain, /HttpOnly/);
	assert.match(plain, /SameSite=Lax/);
	assert.doesNotMatch(plain, /Secure/);
	assert.match(auth.authCookieHeader("beta-01", true), /Secure/);
	assert.match(auth.clearCookieHeader(), /Max-Age=0/);
});

test("登录限流：窗口内失败超限被阻止，窗口过后恢复", () => {
	const auth = new BetaAuth({ registryPath: "unused", secret, loginWindowMs: 60_000, loginMaxAttempts: 3 });
	const t0 = 1_000_000;
	assert.equal(auth.isBlocked("1.2.3.4", t0), false);
	for (const t of [t0, t0 + 1, t0 + 2]) auth.recordFailedAttempt("1.2.3.4", t);
	assert.equal(auth.isBlocked("1.2.3.4", t0 + 3), true, "3 次失败后锁定");
	assert.equal(auth.isBlocked("5.6.7.8", t0 + 3), false, "不影响其他来源");
	assert.equal(auth.isBlocked("1.2.3.4", t0 + 61_000), false, "窗口结束后恢复");
});

test("parseCookies 容错解析", () => {
	const map = parseCookies("a=1; b=hello%20world; malformed; =nokey; c=3");
	assert.equal(map.get("a"), "1");
	assert.equal(map.get("b"), "hello world");
	assert.equal(map.get("c"), "3");
	assert.equal(map.size, 3);
	assert.equal(parseCookies(undefined).size, 0);
});

test("resolveAuthSecret 校验长度并拒绝过短密钥", () => {
	assert.equal(resolveAuthSecret(undefined), undefined);
	assert.equal(resolveAuthSecret("   "), undefined);
	assert.throws(() => resolveAuthSecret("too-short"), /32/);
	const ok = resolveAuthSecret("x".repeat(32));
	assert.equal(ok?.length, 32);
});

test("scrypt 密码哈希：往返成功，错误密码与篡改拒绝，盐随机", () => {
	const digest = hashPassword("correct-horse-battery-9");
	assert.equal(digest.algorithm, "scrypt");
	assert.equal(digest.salt.length, 32, "16 字节盐的 hex");
	assert.equal(digest.hash.length, 128, "64 字节哈希的 hex");
	assert.equal(verifyPassword("correct-horse-battery-9", digest), true);
	assert.equal(verifyPassword("correct-horse-battery-8", digest), false);
	const other = hashPassword("correct-horse-battery-9");
	assert.notEqual(other.salt, digest.salt, "每次加盐随机");
	assert.equal(verifyPassword("correct-horse-battery-9", other), true);
	assert.equal(verifyPassword("x", { salt: "", hash: digest.hash }), false, "空盐拒绝");
});

test("normalizeEmail 规范化与格式校验", () => {
	assert.equal(normalizeEmail("  Alice@Example.COM "), "alice@example.com");
	assert.equal(normalizeEmail("bad"), undefined);
	assert.equal(normalizeEmail("a@b"), undefined);
	assert.equal(normalizeEmail(""), undefined);
	assert.equal(normalizeEmail("a b@example.com"), undefined);
	assert.equal(normalizeEmail(`${"x".repeat(250)}@e.com`), undefined, "超长拒绝");
});
