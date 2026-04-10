import Link from "next/link";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SourceFilter } from "@/components/source-filter";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ sourceId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { sourceId } = await searchParams;

  const sources = await prisma.source.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
  });

  const events = await prisma.event.findMany({
    where: {
      source: { userId: session.user.id },
      ...(sourceId ? { sourceId } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: PAGE_SIZE,
    include: {
      source: { select: { name: true } },
      deliveries: {
        select: { status: true },
      },
    },
  });

  function aggregateStatus(
    deliveries: { status: string }[],
  ): "delivered" | "pending" | "failed" | "exhausted" | "none" {
    if (deliveries.length === 0) return "none";
    if (deliveries.some((d) => d.status === "exhausted")) return "exhausted";
    if (deliveries.some((d) => d.status === "failed")) return "failed";
    if (
      deliveries.some(
        (d) => d.status === "pending" || d.status === "in_flight",
      )
    )
      return "pending";
    return "delivered";
  }

  const statusColor: Record<string, string> = {
    delivered: "bg-emerald-500",
    pending: "bg-amber-500",
    failed: "bg-orange-500",
    exhausted: "bg-red-600",
    none: "bg-zinc-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Most recent {PAGE_SIZE} events
            {sourceId ? " for the selected source" : " across all sources"}.
          </p>
        </div>
        <SourceFilter sources={sources} />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3 text-right">Deliveries</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-16 text-center text-zinc-500"
                >
                  No events yet. Send a webhook to one of your sources to get
                  started.
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const s = aggregateStatus(e.deliveries);
                return (
                  <tr
                    key={e.id}
                    className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="px-4 py-3">
                      <span
                        aria-label={s}
                        className={`inline-block h-2 w-2 rounded-full ${statusColor[s]}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{e.source.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {e.method}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {formatAgo(e.receivedAt)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {e.deliveries.length}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/events/${e.id}`}
                        className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
