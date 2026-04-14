// End-to-end smoke test.
//
// Requires:
//  - Docker compose stack running (Postgres + Redis)
//  - Migrations applied (`npx prisma migrate dev`)
//  - The Next dev server running on :3000 (`npm run dev`)
//  - The delivery worker running (`npm run worker`)
//
// The script itself only owns:
//  - Creating a fresh test user/source/destination/route (idempotent — uses a
//    fixed slug so repeat runs reset the same row)
//  - Spinning up a tiny local HTTP listener to act as the destination
//  - Firing test webhooks at the ingest endpoint
//  - Polling the Delivery rows until they settle
//
// It exits non-zero on any assertion failure so it can be used as a CI gate.

import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";

import { prisma } from "../lib/prisma";
import { encrypt } from "../lib/crypto";

const INGEST_BASE = process.env.APP_URL ?? "http://localhost:3000";
const LISTENER_HOST = "127.0.0.1";

type ReceivedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

function startListener(): Promise<{
  url: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const received: ReceivedRequest[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers[k] = v;
          else if (Array.isArray(v)) headers[k] = v.join(",");
        }
        received.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers,
          body,
        });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    server.listen(0, LISTENER_HOST, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://${LISTENER_HOST}:${addr.port}/hook`,
        received,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function ensureTestEntities(opts: {
  slug: string;
  destinationUrl: string;
  verifyStyle?: "stripe" | "github" | "generic-sha256";
  signingSecret?: string;
  rateLimitPerSec?: number;
  rateLimitBurst?: number;
}) {
  // One fixed user for smoke runs so repeat invocations are idempotent.
  const user = await prisma.user.upsert({
    where: { email: "smoke@hooksmith.local" },
    create: {
      email: "smoke@hooksmith.local",
      name: "Smoke Test",
    },
    update: {},
  });

  // Tear down any old destination/source with this slug so we start clean.
  await prisma.source.deleteMany({ where: { slug: opts.slug } });

  const destination = await prisma.destination.create({
    data: {
      userId: user.id,
      name: `smoke-dest-${Date.now()}`,
      url: opts.destinationUrl,
      timeoutMs: 5000,
    },
  });

  const source = await prisma.source.create({
    data: {
      userId: user.id,
      name: "smoke-source",
      slug: opts.slug,
      signingSecret: opts.signingSecret
        ? encrypt(opts.signingSecret)
        : null,
      verifyStyle: opts.verifyStyle ?? null,
      rateLimitPerSec: opts.rateLimitPerSec ?? null,
      rateLimitBurst: opts.rateLimitBurst ?? null,
    },
  });

  await prisma.route.create({
    data: {
      sourceId: source.id,
      destinationId: destination.id,
      enabled: true,
    },
  });

  return { user, source, destination };
}

async function pollUntilDelivered(
  eventId: string,
  maxMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const deliveries = await prisma.delivery.findMany({
      where: { eventId },
      select: { status: true, lastError: true, responseCode: true },
    });
    if (deliveries.length === 0) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const allSettled = deliveries.every(
      (d) =>
        d.status === "delivered" ||
        d.status === "exhausted",
    );
    if (allSettled) {
      console.log("  deliveries:", deliveries);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`deliveries for event ${eventId} didn't settle in ${maxMs}ms`);
}

async function assertEq<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: expected ${expected!}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
}

async function smokePlain() {
  console.log("\n=== smoke: plain ingest → delivery ===");
  const listener = await startListener();
  try {
    await ensureTestEntities({
      slug: "smoke-plain",
      destinationUrl: listener.url,
    });

    const body = JSON.stringify({
      id: "evt_smoke_1",
      type: "test.event",
      data: { amount: 100 },
    });
    const res = await fetch(`${INGEST_BASE}/api/ingest/smoke-plain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const resJson = (await res.json()) as { ok?: boolean; eventId?: string };
    await assertEq("ingest HTTP status", res.status, 202);
    await assertEq("ingest ok flag", resJson.ok, true);

    if (!resJson.eventId) {
      throw new Error("ingest response missing eventId");
    }
    await pollUntilDelivered(resJson.eventId);

    await assertEq("destination received one request", listener.received.length, 1);
    if (listener.received[0]) {
      await assertEq(
        "destination body matches",
        listener.received[0].body,
        body,
      );
    }
  } finally {
    await listener.close();
  }
}

async function smokeHmac() {
  console.log("\n=== smoke: HMAC-verified ingest ===");
  const listener = await startListener();
  const secret = "whsec_smoke_test";
  try {
    await ensureTestEntities({
      slug: "smoke-hmac",
      destinationUrl: listener.url,
      verifyStyle: "github",
      signingSecret: secret,
    });

    const body = JSON.stringify({ id: "evt_smoke_2", type: "ping" });
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");

    // First: without signature → should 401.
    const res401 = await fetch(`${INGEST_BASE}/api/ingest/smoke-hmac`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await assertEq("unsigned request rejected", res401.status, 401);

    // Second: with correct signature → 202.
    const res202 = await fetch(`${INGEST_BASE}/api/ingest/smoke-hmac`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      body,
    });
    await assertEq("signed request accepted", res202.status, 202);
    const { eventId } = (await res202.json()) as { eventId: string };
    await pollUntilDelivered(eventId);
    await assertEq(
      "destination received the signed event",
      listener.received.length,
      1,
    );
  } finally {
    await listener.close();
  }
}

async function smokeRateLimit() {
  console.log("\n=== smoke: rate limiter ===");
  const listener = await startListener();
  try {
    // Very tight limit so we can easily exhaust it.
    await ensureTestEntities({
      slug: "smoke-rl",
      destinationUrl: listener.url,
      rateLimitPerSec: 1,
      rateLimitBurst: 3,
    });

    const body = JSON.stringify({ n: 0 });
    const results: number[] = [];
    // Fire 10 requests back-to-back; expect ~3 202s and ~7 429s.
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${INGEST_BASE}/api/ingest/smoke-rl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      results.push(r.status);
    }
    const accepted = results.filter((s) => s === 202).length;
    const limited = results.filter((s) => s === 429).length;
    console.log(`  results: ${accepted} × 202, ${limited} × 429`);
    if (accepted < 1 || accepted > 4) {
      console.error(`  ✗ expected 1-4 accepted, got ${accepted}`);
      process.exitCode = 1;
    } else {
      console.log("  ✓ accepted count within expected range");
    }
    if (limited < 6) {
      console.error(`  ✗ expected at least 6 rate-limited, got ${limited}`);
      process.exitCode = 1;
    } else {
      console.log("  ✓ rate-limited count within expected range");
    }
  } finally {
    await listener.close();
  }
}

async function main() {
  const only = process.argv[2];
  try {
    if (!only || only === "plain") await smokePlain();
    if (!only || only === "hmac") await smokeHmac();
    if (!only || only === "rl") await smokeRateLimit();
  } finally {
    await prisma.$disconnect();
  }
  if (process.exitCode && process.exitCode !== 0) {
    console.error("\n❌ smoke test failed");
  } else {
    console.log("\n✅ smoke test passed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
