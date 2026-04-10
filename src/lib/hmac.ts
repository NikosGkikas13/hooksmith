import crypto from "node:crypto";

/**
 * Constant-time comparison of two hex strings of equal length.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Verify a generic `sha256=<hex>` style signature over the raw body.
 * Used for GitHub-style and generic HMAC webhook sources.
 */
export function verifySha256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const received = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return timingSafeEqualHex(received, expected);
}

/**
 * Verify a Stripe-style `Stripe-Signature: t=...,v1=...` header.
 * Does not enforce a max skew — add one if needed for production.
 */
export function verifyStripe(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!ts || !v1) return false;
  const payload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
  return timingSafeEqualHex(v1, expected);
}

export type VerifyStyle = "stripe" | "github" | "generic-sha256";

export function verifySignature(
  style: VerifyStyle,
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  switch (style) {
    case "stripe":
      return verifyStripe(rawBody, headers.get("stripe-signature"), secret);
    case "github":
      return verifySha256(
        rawBody,
        headers.get("x-hub-signature-256"),
        secret,
      );
    case "generic-sha256":
      return verifySha256(
        rawBody,
        headers.get("x-signature-256") ?? headers.get("x-signature"),
        secret,
      );
  }
}
