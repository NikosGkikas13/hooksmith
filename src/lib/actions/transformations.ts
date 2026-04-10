"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateTransformation } from "@/lib/ai/transform";
import { runTransformation } from "@/lib/sandbox/quickjs";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

async function ensureRouteOwnership(
  userId: string,
  routeId: string,
): Promise<void> {
  const route = await prisma.route.findFirst({
    where: { id: routeId, source: { userId } },
    select: { id: true },
  });
  if (!route) throw new Error("route not found");
}

/**
 * Generate a fresh transformation via Claude for the given route, using the
 * most recent event on the source as the sample (or an empty object if none).
 */
export async function generateForRoute(
  routeId: string,
  prompt: string,
): Promise<{
  codeJs: string;
  previewOk: boolean;
  previewOutput: unknown;
  previewError: string | null;
  sampleInput: unknown;
}> {
  const userId = await requireUserId();
  await ensureRouteOwnership(userId, routeId);

  const route = await prisma.route.findUniqueOrThrow({
    where: { id: routeId },
    select: { sourceId: true },
  });

  const latest = await prisma.event.findFirst({
    where: { sourceId: route.sourceId },
    orderBy: { receivedAt: "desc" },
    select: { bodyRaw: true },
  });
  let sample: unknown = {};
  if (latest?.bodyRaw) {
    try {
      sample = JSON.parse(latest.bodyRaw);
    } catch {
      sample = { raw: latest.bodyRaw };
    }
  }

  const result = await generateTransformation(userId, prompt, sample);
  return { ...result, sampleInput: sample };
}

/**
 * Persist a transformation against a route (upsert). Re-runs the sandbox
 * preview against the saved sample so the UI reflects the stored code.
 */
export async function saveTransformation(formData: FormData) {
  const userId = await requireUserId();
  const routeId = String(formData.get("routeId"));
  const prompt = String(formData.get("prompt") ?? "");
  const codeJs = String(formData.get("codeJs") ?? "");
  const sampleInputRaw = String(formData.get("sampleInput") ?? "null");

  await ensureRouteOwnership(userId, routeId);

  let sampleInput: unknown = null;
  try {
    sampleInput = JSON.parse(sampleInputRaw);
  } catch {
    sampleInput = null;
  }

  const preview = await runTransformation(codeJs, sampleInput);
  const sampleOutput = preview.ok ? JSON.stringify(preview.value, null, 2) : null;

  await prisma.transformation.upsert({
    where: { routeId },
    create: {
      routeId,
      prompt,
      codeJs,
      sampleInput: sampleInputRaw,
      sampleOutput,
    },
    update: {
      prompt,
      codeJs,
      sampleInput: sampleInputRaw,
      sampleOutput,
    },
  });

  revalidatePath(`/routes/${routeId}/transform`);
  revalidatePath("/routes");
}

export async function deleteTransformation(formData: FormData) {
  const userId = await requireUserId();
  const routeId = String(formData.get("routeId"));
  await ensureRouteOwnership(userId, routeId);
  await prisma.transformation.deleteMany({ where: { routeId } });
  revalidatePath(`/routes/${routeId}/transform`);
  revalidatePath("/routes");
}
