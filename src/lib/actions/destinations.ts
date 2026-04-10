"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";

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

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
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
