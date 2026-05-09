"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { assertSafeUrl, SsrfError } from "@/lib/ssrf";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  headers: z.string().optional(), // "Key: Value" per line
});

// RFC 7230 token: tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+"
// / "-" / "." / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Header field value: visible ASCII + space/tab. No CR/LF — those would
// otherwise let a saved header smuggle a second header into the request
// at delivery time, and `fetch` rejects them by throwing.
const HEADER_VALUE_RE = /^[\t\x20-\x7E]*$/;

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    // Tolerate \r\n line endings.
    const cleaned = line.replace(/\r$/, "");
    if (cleaned.trim() === "") continue;
    const idx = cleaned.indexOf(":");
    if (idx === -1) {
      throw new Error(`Invalid header line (missing ':'): ${cleaned}`);
    }
    const key = cleaned.slice(0, idx).trim();
    const value = cleaned.slice(idx + 1).trim();
    if (!key) continue;
    if (!HEADER_NAME_RE.test(key)) {
      throw new Error(`Invalid header name: ${JSON.stringify(key)}`);
    }
    if (!HEADER_VALUE_RE.test(value)) {
      throw new Error(`Invalid header value for ${key} (control chars not allowed)`);
    }
    out[key] = value;
  }
  return out;
}

export async function createDestination(formData: FormData) {
  const userId = await requireUserId();
  const parsed = createSchema.parse({
    name: formData.get("name"),
    url: formData.get("url"),
    timeoutMs: formData.get("timeoutMs") ?? 10_000,
    headers: formData.get("headers") ?? "",
  });

  const headers = parseHeaders(parsed.headers);
  const hasHeaders = Object.keys(headers).length > 0;

  try {
    await assertSafeUrl(parsed.url);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new Error(`Destination URL rejected: ${err.message}`);
    }
    throw err;
  }

  await prisma.destination.create({
    data: {
      userId,
      name: parsed.name,
      url: parsed.url,
      timeoutMs: parsed.timeoutMs,
      headersEnc: hasHeaders ? encryptJson(headers) : null,
    },
  });

  revalidatePath("/destinations");
}

export async function deleteDestination(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id"));
  await prisma.destination.deleteMany({ where: { id, userId } });
  revalidatePath("/destinations");
}
