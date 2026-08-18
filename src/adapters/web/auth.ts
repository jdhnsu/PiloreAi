import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * 内测认证：一次性邀请码注册表（热重载）+ scrypt 密码哈希 + HMAC 签名 Cookie + 登录限流。
 * 只依赖 Node 内置模块；注册表只存邀请码的 SHA-256 哈希。
 */

export interface BetaAuthOptions {
	/** beta-users.json 路径 */
	registryPath: string;
	/** Cookie HMAC 密钥（≥32 字节） */
	secret: Buffer;
	/** Cookie 名，默认 pilore_auth */
	cookieName?: string;
	/** Cookie 有效期（毫秒），默认 30 天 */
	maxAgeMs?: number;
	/** 限流窗口（毫秒），默认 60 秒 */
	loginWindowMs?: number;
	/** 窗口内最多失败尝试次数，默认 5 */
	loginMaxAttempts?: number;
}

export interface AuthedUser {
	userId: string;
}

/** 注册表校验结果：userId 与对应的邀请码哈希（注册核销用）。 */
export interface VerifiedInviteCode {
	userId: string;
	codeHash: string;
}

interface RegistryFile {
	users?: Array<{ userId?: unknown; codeHash?: unknown }>;
}

const COOKIE_VERSION = "v1";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(header: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!header) return map;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const key = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (key && !map.has(key)) map.set(key, decodeURIComponent(value));
	}
	return map;
}

/** 从 env 解析 Cookie 密钥；未设置时返回 undefined（调用方决定回退策略）。 */
export function resolveAuthSecret(raw: string | undefined): Buffer | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (value.length < 32) throw new Error("AUTH_SECRET 至少 32 个字符");
	return Buffer.from(value, "utf8");
}

/** 邀请码统一大写去空白后参与哈希；与发码脚本保持一致。 */
export function normalizeInviteCode(code: string): string {
	return code.trim().toUpperCase();
}

export function inviteCodeHash(normalizedCode: string): string {
	return createHash("sha256").update(normalizedCode).digest("hex");
}

export interface PasswordDigest {
	algorithm: "scrypt";
	salt: string;
	hash: string;
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): PasswordDigest {
	const salt = randomBytes(16);
	const hash = scryptSync(Buffer.from(password, "utf8"), salt, SCRYPT_KEYLEN, SCRYPT_COST);
	return { algorithm: "scrypt", salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export function verifyPassword(password: string, digest: { salt: string; hash: string }): boolean {
	const salt = Buffer.from(digest.salt, "hex");
	const expected = Buffer.from(digest.hash, "hex");
	if (salt.length === 0 || expected.length === 0) return false;
	const derived = scryptSync(Buffer.from(password, "utf8"), salt, expected.length, SCRYPT_COST);
	return timingSafeEqual(derived, expected);
}

/** 邮箱规范化：去空白转小写 + 基本格式校验；不合法返回 undefined。 */
export function normalizeEmail(raw: string): string | undefined {
	const email = raw.trim().toLowerCase();
	if (!email || email.length > 254) return undefined;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
	return email;
}

export class BetaAuth {
	private readonly options: Required<Omit<BetaAuthOptions, "cookieName">> & { cookieName: string };
	/** 简单固定窗口限流：记录每个来源首次失败时间与失败次数。 */
	private readonly attempts = new Map<string, { count: number; windowStart: number }>();

	constructor(options: BetaAuthOptions) {
		this.options = {
			registryPath: options.registryPath,
			secret: options.secret,
			cookieName: options.cookieName ?? "pilore_auth",
			maxAgeMs: options.maxAgeMs ?? THIRTY_DAYS_MS,
			loginWindowMs: options.loginWindowMs ?? 60_000,
			loginMaxAttempts: options.loginMaxAttempts ?? 5,
		};
		if (this.options.secret.length < 32) throw new Error("AUTH_SECRET 至少 32 字节");
	}

	get cookieName(): string {
		return this.options.cookieName;
	}

	/** 每次登录都重读注册表：删除某行即可即时吊销该用户，无需重启。 */
	async loadRegistry(): Promise<Map<string, string>> {
		const raw = await readFile(this.options.registryPath, "utf8");
		const parsed = JSON.parse(raw) as RegistryFile;
		const byHash = new Map<string, string>();
		for (const entry of parsed.users ?? []) {
			if (typeof entry.userId !== "string" || !/^[\w-]{1,64}$/.test(entry.userId)) continue;
			if (typeof entry.codeHash !== "string" || !/^[0-9a-f]{64}$/.test(entry.codeHash)) continue;
			byHash.set(entry.codeHash, entry.userId);
		}
		return byHash;
	}

	/** 校验邀请码；成功返回 userId 与码哈希，失败返回 undefined。注册表读不到时抛出（区别于"码错误"）。 */
	async authenticate(code: string): Promise<VerifiedInviteCode | undefined> {
		const normalized = normalizeInviteCode(code);
		if (!normalized) return undefined;
		const registry = await this.loadRegistry();
		const hash = inviteCodeHash(normalized);
		const userId = registry.get(hash);
		return userId ? { userId, codeHash: hash } : undefined;
	}

	/** 窗口内失败次数已达上限时返回 true（此时不应再尝试验证邀请码）。 */
	isBlocked(source: string, now = Date.now()): boolean {
		const entry = this.attempts.get(source);
		return !!entry && now - entry.windowStart < this.options.loginWindowMs && entry.count >= this.options.loginMaxAttempts;
	}

	/** 失败尝试限流：窗口内超过上限返回 false。只计失败，不影响成功登录。 */
	recordFailedAttempt(source: string, now = Date.now()): boolean {
		const entry = this.attempts.get(source);
		if (!entry || now - entry.windowStart >= this.options.loginWindowMs) {
			this.attempts.set(source, { count: 1, windowStart: now });
			return true;
		}
		entry.count += 1;
		return entry.count <= this.options.loginMaxAttempts;
	}

	/** 签发 Cookie 值：v1.userId.expiresMs.hmac */
	issueCookieValue(userId: string, now = Date.now()): string {
		const expiresMs = now + this.options.maxAgeMs;
		const payload = `${COOKIE_VERSION}.${userId}.${expiresMs}`;
		const sig = createHmac("sha256", this.options.secret).update(payload).digest("hex");
		return `${payload}.${sig}`;
	}

	/** 校验 Cookie 值；签名错误、过期或格式异常返回 undefined。 */
	verifyCookieValue(value: string | undefined, now = Date.now()): AuthedUser | undefined {
		if (!value) return undefined;
		const parts = value.split(".");
		if (parts.length !== 4 || parts[0] !== COOKIE_VERSION) return undefined;
		const [version, userId, expiresRaw, sig] = parts;
		if (!/^[\w-]{1,64}$/.test(userId) || !/^\d+$/.test(expiresRaw) || !/^[0-9a-f]{64}$/.test(sig)) return undefined;
		const expected = createHmac("sha256", this.options.secret).update(`${version}.${userId}.${expiresRaw}`).digest("hex");
		if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"))) return undefined;
		if (Number(expiresRaw) <= now) return undefined;
		return { userId };
	}

	/** 从请求 Cookie 头解析已登录用户。 */
	verifyCookieHeader(cookieHeader: string | undefined, now = Date.now()): AuthedUser | undefined {
		return this.verifyCookieValue(parseCookies(cookieHeader).get(this.options.cookieName), now);
	}

	/** Set-Cookie 头（登录成功）；secure 时附加 Secure。 */
	authCookieHeader(userId: string, secure: boolean, now = Date.now()): string {
		const value = this.issueCookieValue(userId, now);
		const attrs = [
			`${this.options.cookieName}=${encodeURIComponent(value)}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Lax",
			`Max-Age=${Math.floor(this.options.maxAgeMs / 1000)}`,
		];
		if (secure) attrs.push("Secure");
		return attrs.join("; ");
	}

	/** Set-Cookie 头（登出：立即过期）。 */
	clearCookieHeader(): string {
		return `${this.options.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
	}
}

/** 生成长度为 bytes 的随机密钥（hex 输出），供部署时生成 AUTH_SECRET。 */
export function generateAuthSecret(bytes = 32): string {
	return randomBytes(bytes).toString("hex");
}
