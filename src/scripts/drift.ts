// Nightly drift-check entry point.
// Run via: `npm run job:drift`. Schedule externally (cron, GitHub Actions, etc).
//
// Walks every source with recent traffic, diffs its fingerprint against the
// stored baseline, and logs any drift. Emailing the owner on drift is TODO —
// for now we just persist the updated fingerprint and log a summary.

import "dotenv/config";

import { prisma } from "../lib/prisma";
import { checkSourceDrift } from "../lib/ai/drift";

async function main() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sources = await prisma.source.findMany({
    where: { events: { some: { receivedAt: { gte: since } } } },
    select: { id: true, name: true, userId: true },
  });
  console.log(`[drift] checking ${sources.length} sources with recent traffic`);

  for (const s of sources) {
    try {
      const report = await checkSourceDrift(s.id);
      if (!report) {
        console.log(`[drift] ${s.name}: no baseline or not enough data`);
        continue;
      }
      if (report.drifted) {
        console.warn(
          `[drift] ${s.name}: DRIFTED — ${report.summary}`,
          { added: report.added, removed: report.removed, changed: report.changed },
        );
      } else {
        console.log(`[drift] ${s.name}: stable`);
      }
    } catch (err) {
      console.error(`[drift] ${s.name}: error`, err);
    }
  }
}

main()
  .catch((err) => {
    console.error("[drift] fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
