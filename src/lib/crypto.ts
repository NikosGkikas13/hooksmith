import crypto from "node:crypto";

// AES-256-GCM envelope encryption for secrets (destination headers, source signing secrets).
// Key: base64-encoded 32 bytes from ENCRYPTION_KEY.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Encrypt plaintext. Returns base64 of `iv || tag || ciphertext`.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt the output of {@link encrypt}. Throws on tampering.
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}
