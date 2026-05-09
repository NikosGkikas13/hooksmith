// Nightly drift-check entry point.
// Run via: `npm run job:drift`. Schedule externally (cron, GitHub Actions, etc).
//
// Walks every source with recent traffic, diffs its fingerprint against the
// stored baseline, persists the updated fingerprint, and emails each owner
// once with a single message covering all of their drifted sources for
// the run. Set DRIFT_DRY_RUN=1 to skip sending.

import "dotenv/config";

import { prisma } from "../lib/prisma";
import { checkSourceDrift } from "../lib/ai/drift";
import { sendMail } from "../lib/mailer";

type DriftHit = {
  sourceName: string;
  summary: string;
  added: string[];
  removed: string[];
  changed: string[];
};

async function main() {
  const dryRun = process.env.DRIFT_DRY_RUN === "1";
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sources = await prisma.source.findMany({
    where: { events: { some: { receivedAt: { gte: since } } } },
    select: { id: true, name: true, userId: true },
  });
  console.log(
    `[drift] checking ${sources.length} sources with recent traffic${dryRun ? " (DRY RUN)" : ""}`,
  );

  // Group drift hits by user so each owner gets one consolidated email.
  const byUser = new Map<string, DriftHit[]>();

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
        const hits = byUser.get(s.userId) ?? [];
        hits.push({
          sourceName: s.name,
          summary: report.summary,
          added: report.added,
          removed: report.removed,
          changed: report.changed,
        });
        byUser.set(s.userId, hits);
      } else {
        console.log(`[drift] ${s.name}: stable`);
      }
    } catch (err) {
      console.error(`[drift] ${s.name}: error`, err);
    }
  }

  if (byUser.size === 0) {
    console.log("[drift] no drift detected, no email to send");
    return;
  }

  const userRows = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, email: true },
  });

  for (const u of userRows) {
    const hits = byUser.get(u.id) ?? [];
    const body = renderDriftEmail(hits);
    if (dryRun) {
      console.log(`\n===== DRIFT for ${u.email} =====\n${body}\n`);
      continue;
    }
    try {
      await sendMail({
        to: u.email,
        subject: `HookSmith: schema drift detected on ${hits.length} source${hits.length === 1 ? "" : "s"}`,
        text: body,
      });
      console.log(`[drift] ${u.email}: sent (${hits.length} sources)`);
    } catch (err) {
      console.error(`[drift] ${u.email}: send failed`, err);
    }
  }
}

function renderDriftEmail(hits: DriftHit[]): string {
  const lines: string[] = [
    `Schema drift was detected on ${hits.length} of your sources in the last 24 hours.`,
    "",
  ];
  for (const h of hits) {
    lines.push(`# ${h.sourceName}`);
    lines.push(h.summary);
    if (h.added.length) lines.push(`  Added:   ${h.added.join(", ")}`);
    if (h.removed.length) lines.push(`  Removed: ${h.removed.join(", ")}`);
    if (h.changed.length) lines.push(`  Changed: ${h.changed.join(", ")}`);
    lines.push("");
  }
  lines.push(
    "Open HookSmith to review and (if expected) acknowledge the new shape.",
  );
  return lines.join("\n");
}

main()
  .catch((err) => {
    console.error("[drift] fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
