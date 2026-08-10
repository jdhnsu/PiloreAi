import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CryptoProviderError, createAes256GcmCryptoProvider, type CryptoContext } from "../../src/index.js";

const context: CryptoContext = {
	tenantId: "tenant-1",
	sessionId: "session-1",
	revision: 3,
	schemaVersion: 1,
	purpose: "snapshot",
};

test("AES-256-GCM 正常往返并支持 keyId", async () => {
	const provider = createAes256GcmCryptoProvider({ primaryKeyId: "k1", keys: { k1: randomBytes(32), old: randomBytes(32) } });
	const plaintext = new TextEncoder().encode("学生消息：闭包是什么？");
	const encrypted = await provider.encrypt(plaintext, context);
	assert.equal(encrypted.keyId, "k1");
	assert.notDeepEqual(Buffer.from(encrypted.ciphertext), Buffer.from(plaintext));
	assert.deepEqual(Buffer.from(await provider.decrypt(encrypted, context)), Buffer.from(plaintext));
});

test("AES-256-GCM 拒绝密文篡改、AAD 不匹配和错误 key", async () => {
	const key = randomBytes(32);
	const provider = createAes256GcmCryptoProvider({ primaryKeyId: "k1", keys: { k1: key } });
	const encrypted = await provider.encrypt(new TextEncoder().encode("secret"), context);
	const tampered = { ...encrypted, ciphertext: Uint8Array.from(encrypted.ciphertext) };
	tampered.ciphertext[0] ^= 1;
	await assert.rejects(provider.decrypt(tampered, context), CryptoProviderError);
	await assert.rejects(provider.decrypt(encrypted, { ...context, revision: 4 }), CryptoProviderError);
	const wrong = createAes256GcmCryptoProvider({ primaryKeyId: "k1", keys: { k1: randomBytes(32) } });
	await assert.rejects(wrong.decrypt(encrypted, context), CryptoProviderError);
});

test("AES-256-GCM 初始化拒绝非 32 字节密钥", () => {
	assert.throws(() => createAes256GcmCryptoProvider({ primaryKeyId: "bad", keys: { bad: randomBytes(16) } }), /32 字节/);
});
