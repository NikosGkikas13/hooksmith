// Dev-only: generate ~120 events across two sources with a mix of delivery
// outcomes so the Events page filters/pagination have something real to
// exercise. Cleans up its own data on each run via fixed slugs.

import "dotenv/config";
import http from "node:http";
import { AddressInfo } from "node:net";

import { prisma } from "../lib/prisma";

const INGEST_BASE = process.env.APP_URL ?? "http://localhost:3000";

function startListener(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/ok`,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function main() {
  const listener = await startListener();

  try {
    const user = await prisma.user.upsert({
      where: { email: "smoke@hooksmith.local" },
      create: { email: "smoke@hooksmith.local", name: "Smoke Test" },
      update: {},
    });

    // Reset any previous seed data.
    await prisma.source.deleteMany({
      where: { slug: { in: ["seed-good", "seed-bad"] } },
    });

    const goodDest = await prisma.destination.create({
      data: {
        userId: user.id,
        name: `seed-good-dest`,
        url: listener.url,
        timeoutMs: 3000,
      },
    });
    const badDest = await prisma.destination.create({
      data: {
        userId: user.id,
        name: `seed-bad-dest`,
        // Port 1 is reserved and nothing should listen; connect will fail fast.
        url: "http://127.0.0.1:1/dead",
        timeoutMs: 1000,
      },
    });

    // Two sources that won't trip the default rate limit (10/s, burst 20).
    // Use generous per-source overrides so the seed can run fast.
    const goodSource = await prisma.source.create({
      data: {
        userId: user.id,
        name: "seed-good-source",
        slug: "seed-good",
        rateLimitPerSec: 500,
        rateLimitBurst: 500,
      },
    });
    const badSource = await prisma.source.create({
      data: {
        userId: user.id,
        name: "seed-bad-source",
        slug: "seed-bad",
        rateLimitPerSec: 500,
        rateLimitBurst: 500,
      },
    });
    await prisma.route.create({
      data: {
        sourceId: goodSource.id,
        destinationId: goodDest.id,
        enabled: true,
      },
    });
    await prisma.route.create({
      data: {
        sourceId: badSource.id,
        destinationId: badDest.id,
        enabled: true,
      },
    });

    console.log("seeding 80 good + 40 bad events...");

    const tasks: Promise<Response>[] = [];
    for (let i = 0; i < 80; i++) {
      tasks.push(
        fetch(`${INGEST_BASE}/api/ingest/seed-good`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ n: i, type: "test.good" }),
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      tasks.push(
        fetch(`${INGEST_BASE}/api/ingest/seed-bad`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ n: i, type: "test.bad" }),
        }),
      );
    }

    const results = await Promise.all(tasks);
    const accepted = results.filter((r) => r.status === 202).length;
    console.log(`  ${accepted}/${results.length} ingest calls accepted`);

    // Wait for the worker to process the first pass of every delivery so:
    //  - Good events settle as `delivered` before we close the listener
    //  - Bad events settle as `failed` (ECONNREFUSED to port 1 is fast, and
    //    first retry isn't scheduled until +10s, so they're stable here)
    console.log("waiting 8s for worker to drain first pass...");
    await new Promise((r) => setTimeout(r, 8000));

    const counts = await prisma.delivery.groupBy({
      by: ["status"],
      where: {
        destination: {
          name: { in: ["seed-good-dest", "seed-bad-dest"] },
        },
      },
      _count: true,
    });
    console.log("  delivery counts:", counts);
  } finally {
    await listener.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
