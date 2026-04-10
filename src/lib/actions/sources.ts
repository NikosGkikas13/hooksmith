"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

function randomSlug(): string {
  return crypto.randomBytes(6).toString("base64url").toLowerCase();
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  verifyStyle: z.enum(["none", "stripe", "github", "generic-sha256"]),
  signingSecret: z.string().optional(),
});

export async function createSource(formData: FormData) {
  const userId = await requireUserId();
  const parsed = createSchema.parse({
    name: formData.get("name"),
    verifyStyle: formData.get("verifyStyle") ?? "none",
    signingSecret: formData.get("signingSecret") ?? undefined,
  });

  const slug = `${randomSlug()}`;

  await prisma.source.create({
    data: {
      userId,
      name: parsed.name,
      slug,
      verifyStyle:
        parsed.verifyStyle === "none" ? null : parsed.verifyStyle,
      signingSecret:
        parsed.verifyStyle !== "none" && parsed.signingSecret
          ? encrypt(parsed.signingSecret)
          : null,
    },
  });

  revalidatePath("/sources");
}

export async function deleteSource(formData: FormData) {
  const userId = await requireUserId();
  const id = String(formData.get("id"));
  await prisma.source.deleteMany({ where: { id, userId } });
  revalidatePath("/sources");
}
