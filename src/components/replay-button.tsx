"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReplayButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  async function replay() {
    setResult(null);
    const res = await fetch(`/api/events/${eventId}/replay`, {
      method: "POST",
    });
    if (res.ok) {
      const data = (await res.json()) as { deliveries: number };
      setResult(`Queued ${data.deliveries} deliveries`);
      startTransition(() => router.refresh());
    } else {
      setResult("Replay failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-zinc-500">{result}</span>
      )}
      <button
        type="button"
        onClick={replay}
        disabled={isPending}
        className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {isPending ? "Replaying…" : "Replay"}
      </button>
    </div>
  );
}
