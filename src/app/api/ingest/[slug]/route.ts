import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { verifySignature, type VerifyStyle } from "@/lib/hmac";
import { getDeliveryQueue } from "@/lib/queue";
import { checkRateLimit, configForSource } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;

  const source = await prisma.source.findUnique({
    where: { slug },
    include: {
      routes: {
        where: { enabled: true },
        include: { destination: true },
      },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "unknown source" }, { status: 404 });
  }

  // Rate limit BEFORE reading the body — we want to shed load before
  // allocating memory for a large payload. Failures in the limiter (e.g.
  // Redis briefly unavailable) are logged and fail-open so we don't drop
  // legitimate traffic during a cache outage.
  try {
    const rl = await checkRateLimit(source.id, configForSource(source));
    if (!rl.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return NextResponse.json(
        { error: "rate limited" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Remaining": "0",
          },
        },
      );
    }
  } catch (err) {
    console.error("[ingest] rate limiter error (failing open):", err);
  }

  const rawBody = await req.text();

  // Optional HMAC verification.
  if (source.signingSecret && source.verifyStyle) {
    try {
      const secret = decrypt(source.signingSecret);
      const ok = verifySignature(
        source.verifyStyle as VerifyStyle,
        rawBody,
        req.headers,
        secret,
      );
      if (!ok) {
        return NextResponse.json(
          { error: "invalid signature" },
          { status: 401 },
        );
      }
    } catch (err) {
      console.error("[ingest] signature verification error:", err);
      return NextResponse.json(
        { error: "signature verification failed" },
        { status: 500 },
      );
    }
  }

  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headersObj[k] = v;
  });

  const remoteIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  // Persist the event + one pending delivery per routed destination, then enqueue.
  const event = await prisma.event.create({
    data: {
      sourceId: source.id,
      method: req.method,
      headersJson: headersObj,
      bodyRaw: rawBody,
      remoteIp,
      deliveries: {
        create: source.routes.map((r) => ({
          destinationId: r.destinationId,
          status: "pending",
        })),
      },
    },
    include: { deliveries: true },
  });

  // Enqueue one job per routed destination.
  const queue = getDeliveryQueue();
  await Promise.all(
    event.deliveries.map((d) =>
      queue.add("deliver", { deliveryId: d.id }),
    ),
  );

  return NextResponse.json(
    { ok: true, eventId: event.id, deliveries: event.deliveries.length },
    { status: 202 },
  );
}
