import { beforeAll, afterAll, describe, it, expect } from "vitest";
import crypto from "node:crypto";

import { encrypt, decrypt, encryptJson, decryptJson } from "./crypto";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  // 32-byte key, base64-encoded.
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("crypto.encrypt / decrypt", () => {
  it("round-trips plaintext", () => {
    const pt = "hello, webhook world";
    const ct = encrypt(pt);
    expect(ct).not.toBe(pt);
    expect(decrypt(ct)).toBe(pt);
  });

  it("round-trips unicode and long payloads", () => {
    const pt = "🚀 ".repeat(500) + "日本語";
    expect(decrypt(encrypt(pt))).toBe(pt);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const pt = "same-input";
    const a = encrypt(pt);
    const b = encrypt(pt);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(pt);
    expect(decrypt(b)).toBe(pt);
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const ct = encrypt("sensitive");
    const buf = Buffer.from(ct, "base64");
    // Flip a byte in the ciphertext section (past iv+tag).
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const ct = encrypt("sensitive");
    const buf = Buffer.from(ct, "base64");
    // Flip a byte inside the tag region (bytes 12..28).
    buf[20] ^= 0x01;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("throws on ciphertext shorter than iv+tag", () => {
    expect(() => decrypt(Buffer.alloc(10).toString("base64"))).toThrow(
      /too short/,
    );
  });

  it("throws on missing ENCRYPTION_KEY", () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it("throws when key is not 32 bytes", () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(() => encrypt("x")).toThrow(/32 bytes/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it("fails cross-key decryption", () => {
    const ct = encrypt("secret");
    const otherKey = crypto.randomBytes(32).toString("base64");
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = otherKey;
    try {
      expect(() => decrypt(ct)).toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});

describe("crypto.encryptJson / decryptJson", () => {
  it("round-trips nested structures", () => {
    const obj = {
      "X-Api-Key": "sk-123",
      flags: { beta: true, count: 42 },
      list: ["a", "b", null],
    };
    const ct = encryptJson(obj);
    expect(decryptJson(ct)).toEqual(obj);
  });
});
