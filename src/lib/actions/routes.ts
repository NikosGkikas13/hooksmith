"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

/**
 * Toggle a route between a source and a destination. If the pair doesn't exist,
 * create it enabled; if it exists, flip the enabled flag.
 */
export async function toggleRoute(formData: FormData) {
  const userId = await requireUserId();
  const sourceId = String(formData.get("sourceId"));
  const destinationId = String(formData.get("destinationId"));

  // Ownership check — both source and destination must belong to the user.
  const [source, destination] = await Promise.all([
    prisma.source.findFirst({ where: { id: sourceId, userId } }),
    prisma.destination.findFirst({ where: { id: destinationId, userId } }),
  ]);
  if (!source || !destination) throw new Error("not found");

  const existing = await prisma.route.findUnique({
    where: { sourceId_destinationId: { sourceId, destinationId } },
  });

  if (existing) {
    await prisma.route.update({
      where: { id: existing.id },
      data: { enabled: !existing.enabled },
    });
  } else {
    await prisma.route.create({
      data: { sourceId, destinationId, enabled: true },
    });
  }

  revalidatePath("/routes");
}
