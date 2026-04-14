// Dev-only: verify the where-clause logic the Events page builds matches
// what we expect against real seed data. Not part of CI.

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function run() {
  const user = await prisma.user.findUnique({
    where: { email: "smoke@hooksmith.local" },
  });
  if (!user) throw new Error("seed user not found — run seed-events first");
  const userId = user.id;

  const sources = await prisma.source.findMany({
    where: { userId, slug: { in: ["seed-good", "seed-bad"] } },
  });
  const good = sources.find((s) => s.slug === "seed-good");
  const bad = sources.find((s) => s.slug === "seed-bad");
  if (!good || !bad) throw new Error("seed sources not found");

  const cases: { label: string; where: Parameters<typeof prisma.event.count>[0]["where"] }[] = [
    {
      label: "all time, all sources, all status",
      where: { source: { userId } },
    },
    {
      label: "only seed-good source",
      where: { source: { userId }, sourceId: good.id },
    },
    {
      label: "only seed-bad source",
      where: { source: { userId }, sourceId: bad.id },
    },
    {
      label: "status=delivered",
      where: {
        source: { userId },
        deliveries: { some: { status: "delivered" } },
      },
    },
    {
      label: "status=failed",
      where: {
        source: { userId },
        deliveries: { some: { status: "failed" } },
      },
    },
    {
      label: "status=exhausted (should be 0)",
      where: {
        source: { userId },
        deliveries: { some: { status: "exhausted" } },
      },
    },
    {
      label: "since=1h",
      where: {
        source: { userId },
        receivedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    },
    {
      label: "since=1m (should be ~120)",
      where: {
        source: { userId },
        receivedAt: { gte: new Date(Date.now() - 60 * 1000) },
      },
    },
    {
      label: "good source + failed (should be 0)",
      where: {
        source: { userId },
        sourceId: good.id,
        deliveries: { some: { status: "failed" } },
      },
    },
    {
      label: "bad source + failed",
      where: {
        source: { userId },
        sourceId: bad.id,
        deliveries: { some: { status: "failed" } },
      },
    },
  ];

  for (const c of cases) {
    const n = await prisma.event.count({ where: c.where });
    console.log(`  ${String(n).padStart(4)}  ${c.label}`);
  }
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
