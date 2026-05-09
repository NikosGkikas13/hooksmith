// Headers whose *values* should not survive past the ingest boundary.
// Two separate uses:
//   - The worker drops them entirely from the inbound→destination forward
//     so a Stripe signature, an HMAC, or a stray Cookie cannot reach a
//     downstream service that wasn't supposed to see it.
//   - The ingest handler redacts (rather than drops) the value before
//     writing Event.headersJson so the persisted event log isn't a
//     long-lived secret store, while still recording that the header
//     was present.
//
// Names are lower-cased for case-insensitive matching.
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  // credentials
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  // source-side signing — meaningful only against the source secret,
  // and (per Stripe/GitHub guidance) should not be kept around after
  // verification.
  "x-hub-signature",
  "x-hub-signature-256",
  "stripe-signature",
  "x-signature",
  "x-signature-256",
  "x-webhook-signature",
  "x-shopify-hmac-sha256",
  "x-slack-signature",
  "x-slack-request-timestamp",
  "x-twilio-signature",
  "x-line-signature",
  "x-github-delivery",
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

const REDACTED = "[redacted]";

/**
 * Returns a copy of `headers` with sensitive values replaced by a
 * placeholder. Header names are preserved so that operators can still
 * see *which* headers were present at ingest.
 */
export function redactSensitiveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeader(k) ? REDACTED : v;
  }
  return out;
}
