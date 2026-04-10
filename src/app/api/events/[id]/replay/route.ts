import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDeliveryQueue } from "@/lib/queue";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      source: {
        include: {
          routes: {
            where: { enabled: true },
          },
        },
      },
    },
  });

  if (!event || event.source.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Create fresh pending deliveries against the *current* route set,
  // so replays honor routing changes made since the original delivery.
  const created = await prisma.$transaction(
    event.source.routes.map((r) =>
      prisma.delivery.create({
        data: {
          eventId: event.id,
          destinationId: r.destinationId,
          status: "pending",
        },
      }),
    ),
  );

  const queue = getDeliveryQueue();
  await Promise.all(
    created.map((d) => queue.add("deliver", { deliveryId: d.id })),
  );

  return NextResponse.json({ ok: true, deliveries: created.length });
}
