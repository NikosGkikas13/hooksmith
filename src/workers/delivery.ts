// Delivery worker — runs as a separate process: `npm run worker`
// Polls the BullMQ delivery queue, posts each event to its destination,
// and reschedules retries with exponential backoff on failure.

import "dotenv/config";
import { Worker, type Job } from "bullmq";

import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/crypto";
import { runTransformation } from "../lib/sandbox/quickjs";
import { evaluateFilter, type FilterAst } from "../lib/filters/evaluator";
import { assertSafeUrl, SsrfError } from "../lib/ssrf";
import {
  DELIVERY_QUEUE,
  MAX_ATTEMPTS,
  backoffForAttempt,
  getConnection,
  getDeliveryQueue,
  type DeliveryJob,
} from "../lib/queue";

// Headers that should never be forwarded to the destination.
const DROP_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

function sanitizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    if (DROP_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

async function processDelivery(job: Job<DeliveryJob>) {
  const { deliveryId } = job.data;

  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      event: true,
      destination: true,
    },
  });

  if (!delivery) {
    // Delivery was deleted between enqueue and processing — skip silently.
    return;
  }
  if (delivery.status === "delivered" || delivery.status === "exhausted") {
    return;
  }

  // Look up the Route (source→destination) to pick up any attached
  // transformation and filter AST. A delivery may exist without a matching
  // route if the route was deleted mid-flight — in that case we just forward
  // the raw body with no transform/filter.
  const route = await prisma.route.findUnique({
    where: {
      sourceId_destinationId: {
        sourceId: delivery.event.sourceId,
        destinationId: delivery.destinationId,
      },
    },
    include: { transformation: true },
  });

  // Apply NL-compiled filter first — if it evaluates false, skip delivery
  // entirely and mark it delivered (non-failure: the rule said "don't send").
  if (route?.filterAst) {
    try {
      let parsedEvent: unknown = {};
      try {
        parsedEvent = JSON.parse(delivery.event.bodyRaw);
      } catch {
        parsedEvent = { raw: delivery.event.bodyRaw };
      }
      const passes = evaluateFilter(
        route.filterAst as unknown as FilterAst,
        parsedEvent,
      );
      if (!passes) {
        await prisma.delivery.update({
          where: { id: deliveryId },
          data: {
            status: "delivered",
            responseCode: null,
            responseBodySnippet: "[skipped by filter]",
            deliveredAt: new Date(),
            lastError: null,
            nextRetryAt: null,
          },
        });
        console.log(`[worker] ${deliveryId} skipped by filter`);
        return;
      }
    } catch (err) {
      console.error(`[worker] filter error for ${deliveryId}:`, err);
      // Fall through and deliver — a broken filter should not block events.
    }
  }

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { status: "in_flight", attemptCount: { increment: 1 } },
  });

  const attempt = delivery.attemptCount + 1; // post-increment

  // Forward headers: preserve original request headers, overlay destination static headers.
  const eventHeaders = sanitizeHeaders(
    delivery.event.headersJson as Record<string, string | string[] | undefined>,
  );
  let destHeaders: Record<string, string> = {};
  if (delivery.destination.headersEnc) {
    try {
      destHeaders = decryptJson<Record<string, string>>(
        delivery.destination.headersEnc,
      );
    } catch (err) {
      console.error(
        `[worker] failed to decrypt destination headers for ${delivery.destinationId}:`,
        err,
      );
    }
  }
  const headers = { ...eventHeaders, ...destHeaders };

  // Apply transformation if the route has one. If the sandbox fails, treat
  // it as a delivery failure with a descriptive error so the retry schedule
  // still kicks in (and the user can see it in the dashboard).
  let body: string = delivery.event.bodyRaw;
  let transformError: string | null = null;
  if (route?.transformation) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(delivery.event.bodyRaw);
    } catch {
      parsed = { raw: delivery.event.bodyRaw };
    }
    const result = await runTransformation(
      route.transformation.codeJs,
      parsed,
    );
    if (result.ok) {
      body = JSON.stringify(result.value);
      // Content-length is dropped by sanitizeHeaders; content-type defaults
      // to the inbound value but we normalise to JSON for transformed payloads.
      headers["content-type"] = "application/json";
    } else {
      transformError = `transform failed: ${result.error}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    delivery.destination.timeoutMs ?? 10_000,
  );

  let responseCode: number | null = null;
  let responseSnippet: string | null = null;
  let errorMsg: string | null = transformError;
  // Set when failure should not be retried — currently only SSRF rejections,
  // since the destination URL is constant across retries.
  let terminal = false;

  if (transformError) {
    // Skip the fetch entirely — fall through to the failure/retry branch.
    clearTimeout(timeout);
  } else try {
    // Re-validate at delivery time: defends against DNS rebinding, and
    // catches destinations that were created before the SSRF guard landed.
    await assertSafeUrl(delivery.destination.url);
    const res = await fetch(delivery.destination.url, {
      method: delivery.event.method,
      headers,
      body,
      signal: controller.signal,
    });
    responseCode = res.status;
    const text = await res.text().catch(() => "");
    responseSnippet = text.slice(0, 2048);
    if (!res.ok) {
      errorMsg = `HTTP ${res.status}`;
    }
  } catch (err) {
    if (err instanceof SsrfError) {
      errorMsg = `blocked by SSRF guard: ${err.message}`;
      terminal = true;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!errorMsg) {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "delivered",
        responseCode,
        responseBodySnippet: responseSnippet,
        deliveredAt: new Date(),
        lastError: null,
        nextRetryAt: null,
      },
    });
    console.log(`[worker] delivered ${deliveryId} (${responseCode})`);
    return;
  }

  // Failure path — decide retry vs exhaust.
  if (terminal || attempt >= MAX_ATTEMPTS) {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "exhausted",
        responseCode,
        responseBodySnippet: responseSnippet,
        lastError: errorMsg,
        nextRetryAt: null,
      },
    });
    console.warn(
      `[worker] exhausted ${deliveryId}${terminal ? " (terminal)" : ` after ${attempt} attempts`}: ${errorMsg}`,
    );
    return;
  }

  const delayMs = backoffForAttempt(attempt);
  const nextRetryAt = new Date(Date.now() + delayMs);
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      status: "failed",
      responseCode,
      responseBodySnippet: responseSnippet,
      lastError: errorMsg,
      nextRetryAt,
    },
  });
  await getDeliveryQueue().add(
    "deliver",
    { deliveryId },
    { delay: delayMs },
  );
  console.warn(
    `[worker] retry ${deliveryId} in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS}): ${errorMsg}`,
  );
}

const worker = new Worker<DeliveryJob>(DELIVERY_QUEUE, processDelivery, {
  connection: getConnection(),
  concurrency: 8,
});

worker.on("ready", () => {
  console.log("[worker] ready");
});
worker.on("error", (err) => {
  console.error("[worker] error:", err);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err);
});

async function shutdown() {
  console.log("[worker] shutting down...");
  await worker.close();
  await getDeliveryQueue().close();
  await getConnection().quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
