"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { diagnoseDelivery, fingerprintShape } from "@/lib/ai/diagnose";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return session.user.id;
}

/**
 * Diagnose a single failed delivery. Caches the result on the delivery row so
 * re-clicking the button just re-reads the cached diagnosis without spending
 * tokens again. Returns the diagnosis so the UI can update without a page
 * reload round-trip.
 */
export async function diagnoseDeliveryAction(
  deliveryId: string,
): Promise<{ summary: string; detail: string }> {
  const userId = await requireUserId();

  const delivery = await prisma.delivery.findFirst({
    where: {
      id: deliveryId,
      destination: { userId },
    },
    include: {
      event: true,
      destination: true,
      diagnosis: true,
    },
  });
  if (!delivery) throw new Error("delivery not found");

  // Return cache if we already spent tokens on this one.
  if (delivery.diagnosis) {
    return {
      summary: delivery.diagnosis.summary,
      detail: delivery.diagnosis.detail,
    };
  }

  // Redact URL: pass only the host, not the full path (which may encode IDs).
  let destinationHost = delivery.destination.url;
  try {
    destinationHost = new URL(delivery.destination.url).host;
  } catch {
    // leave as-is
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(delivery.event.bodyRaw);
  } catch {
    parsedBody = { raw: "(non-JSON body)" };
  }
  const eventShape = fingerprintShape(parsedBody);

  // Only forward safe, non-sensitive headers to the model.
  const srcHeaders = delivery.event.headersJson as Record<string, unknown>;
  const safeHeaders: Record<string, string> = {};
  for (const k of ["content-type", "user-agent", "accept"]) {
    const v = srcHeaders?.[k];
    if (typeof v === "string") safeHeaders[k] = v;
  }

  const result = await diagnoseDelivery(userId, {
    destinationHost,
    method: delivery.event.method,
    responseCode: delivery.responseCode,
    responseBodySnippet: delivery.responseBodySnippet,
    lastError: delivery.lastError,
    requestHeaders: safeHeaders,
    eventShape,
  });

  await prisma.aiDiagnosis.create({
    data: {
      deliveryId: delivery.id,
      summary: result.summary,
      detail: result.detail,
      modelUsed: result.modelUsed,
    },
  });

  revalidatePath(`/events/${delivery.eventId}`);
  return { summary: result.summary, detail: result.detail };
}
