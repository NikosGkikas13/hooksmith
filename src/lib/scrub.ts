// Best-effort scrubber for free-form text we hand off to third parties
// (currently the AI diagnose path forwards a destination response
// snippet to Claude). Goal is to mask the most common patterns that
// destinations are known to echo back — emails, JWTs, bearer tokens —
// so a misbehaving destination can't leak end-user data through the
// diagnosis path.
//
// This is *not* DLP; it's a sanity pass. Anything truly sensitive
// should not reach this snippet in the first place.

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
// JWT-shaped: three base64url segments separated by dots, starting
// with `eyJ` (base64 of `{"`, the typical header start).
const JWT_RE = /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g;
// `Bearer <token>` / `Token <token>` / `Basic <token>` / etc.
const AUTH_RE = /\b(Bearer|Token|Basic|ApiKey|API-Key)\s+[A-Za-z0-9._~+/=\-]{8,}/gi;

/**
 * Mask the most common sensitive patterns in `text`. Returns a copy.
 * Caller-supplied truncation/length limits should be applied *after*
 * scrubbing so masked tokens aren't accidentally split.
 */
export function scrubSensitive(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(JWT_RE, "[jwt]")
    .replace(AUTH_RE, (_m, scheme: string) => `${scheme} [token]`);
}
