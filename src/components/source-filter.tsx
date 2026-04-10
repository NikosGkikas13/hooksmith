"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function SourceFilter({
  sources,
}: {
  sources: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("sourceId") ?? "";

  return (
    <select
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("sourceId", e.target.value);
        else next.delete("sourceId");
        router.push(`/events?${next.toString()}`);
      }}
      className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <option value="">All sources</option>
      {sources.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
