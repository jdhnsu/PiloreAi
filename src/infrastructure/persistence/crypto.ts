import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CryptoContext {
	tenantId: string;
	sessionId: string;
	revision: number;
	schemaVersion: number;
	purpose: "snapshot" | "run";
}

export interface EncryptedPayload {
	algorithm: "AES-256-GCM";
	keyId: string;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
}

export interface CryptoProvider {
	encrypt(plaintext: Uint8Array, context: CryptoContext): Promise<EncryptedPayload>;
	decrypt(payload: EncryptedPayload, context: CryptoContext): Promise<Uint8Array>;
}

export interface Aes256GcmCryptoOptions {
	primaryKeyId: string;
	keys: Record<string, Uint8Array>;
}

export class CryptoProviderError extends Error {
	readonly code = "CRYPTO_PROVIDER_ERROR";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CryptoProviderError";
	}
}

function aad(context: CryptoContext): Buffer {
	return Buffer.from(
		JSON.stringify({
			tenantId: context.tenantId,
			sessionId: context.sessionId,
			revision: context.revision,
			schemaVersion: context.schemaVersion,
			purpose: context.purpose,
		}),
		"utf8",
	);
}

export function createAes256GcmCryptoProvider(options: Aes256GcmCryptoOptions): CryptoProvider {
	const keys = new Map<string, Buffer>();
	for (const [keyId, raw] of Object.entries(options.keys)) {
		const key = Buffer.from(raw);
		if (key.length !== 32) throw new CryptoProviderError(`AES-256-GCM 密钥 ${keyId} 必须正好为 32 字节`);
		keys.set(keyId, key);
	}
	if (!keys.has(options.primaryKeyId)) throw new CryptoProviderError(`找不到主加密密钥: ${options.primaryKeyId}`);

	return {
		async encrypt(plaintext, context) {
			const nonce = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", keys.get(options.primaryKeyId)!, nonce);
			cipher.setAAD(aad(context));
			const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
			const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
			return { algorithm: "AES-256-GCM", keyId: options.primaryKeyId, nonce, ciphertext };
		},
		async decrypt(payload, context) {
			if (payload.algorithm !== "AES-256-GCM") throw new CryptoProviderError(`不支持的加密算法: ${payload.algorithm}`);
			const key = keys.get(payload.keyId);
			if (!key) throw new CryptoProviderError(`找不到解密密钥: ${payload.keyId}`);
			const ciphertext = Buffer.from(payload.ciphertext);
			if (ciphertext.length < 16) throw new CryptoProviderError("密文长度非法");
			try {
				const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.nonce));
				decipher.setAAD(aad(context));
				decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
				return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
			} catch (cause) {
				throw new CryptoProviderError("密文验证失败，密钥、上下文或数据可能不匹配", { cause });
			}
		},
	};
}
