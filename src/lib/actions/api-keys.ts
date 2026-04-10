"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

export async function saveAnthropicKey(formData: FormData) {
  const userId = await requireUserId();
  const key = String(formData.get("apiKey") ?? "").trim();
  if (!key) throw new Error("API key is required");
  if (!key.startsWith("sk-ant-")) {
    throw new Error("That doesn't look like an Anthropic API key (expected sk-ant-…)");
  }

  const enc = encrypt(key);
  await prisma.userApiKey.upsert({
    where: { userId },
    create: { userId, anthropicKeyEnc: enc },
    update: { anthropicKeyEnc: enc },
  });

  revalidatePath("/settings/api-keys");
}

export async function deleteAnthropicKey() {
  const userId = await requireUserId();
  await prisma.userApiKey.deleteMany({ where: { userId } });
  revalidatePath("/settings/api-keys");
}
