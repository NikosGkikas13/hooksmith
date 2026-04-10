// Weekly digest entry point.
// Run via: `npm run job:digest`. Schedule externally (Mondays 9am local).
//
// For each user with activity in the last 7 days, build stats and render a
// digest email body via Claude Haiku. Email delivery is TODO — for now we
// print the rendered markdown to stdout so it can be piped into any sender.

import "dotenv/config";

import { prisma } from "../lib/prisma";
import { buildDigestStats, renderDigestEmail } from "../lib/ai/digest";

async function main() {
  const users = await prisma.user.findMany({
    where: { apiKey: { isNot: null } },
    select: { id: true, email: true, name: true },
  });
  console.log(`[digest] running for ${users.length} users with api keys`);

  for (const u of users) {
    try {
      const stats = await buildDigestStats(u.id);
      if (stats.length === 0) {
        console.log(`[digest] ${u.email}: no activity, skipping`);
        continue;
      }
      const body = await renderDigestEmail(u.id, stats);
      if (!body) {
        console.log(`[digest] ${u.email}: nothing to send`);
        continue;
      }
      console.log(`\n===== DIGEST for ${u.email} =====\n${body}\n`);
      // TODO: wire this into Nodemailer via the auth email transport.
    } catch (err) {
      console.error(`[digest] ${u.email}: error`, err);
    }
  }
}

main()
  .catch((err) => {
    console.error("[digest] fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
