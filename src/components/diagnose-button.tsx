"use client";

import { useState, useTransition } from "react";

import { diagnoseDeliveryAction } from "@/lib/actions/diagnose";

type Props = {
  deliveryId: string;
  hasApiKey: boolean;
  initialSummary?: string | null;
  initialDetail?: string | null;
};

export function DiagnoseButton({
  deliveryId,
  hasApiKey,
  initialSummary,
  initialDetail,
}: Props) {
  const [summary, setSummary] = useState<string | null>(initialSummary ?? null);
  const [detail, setDetail] = useState<string | null>(initialDetail ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await diagnoseDeliveryAction(deliveryId);
        setSummary(res.summary);
        setDetail(res.detail);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (summary) {
    return (
      <div className="mt-3 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950">
        <div className="font-medium text-indigo-900 dark:text-indigo-100">
          AI diagnosis
        </div>
        <p className="mt-1 text-indigo-900 dark:text-indigo-100">{summary}</p>
        {detail && (
          <details className="mt-2">
            <summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">
              Details
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-indigo-900 dark:text-indigo-100">
              {detail}
            </p>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={!hasApiKey || isPending}
        className="inline-flex h-7 items-center rounded-md border border-indigo-300 bg-indigo-50 px-2 text-xs font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
        title={
          hasApiKey
            ? "Ask Claude to diagnose this failure"
            : "Add a Claude API key in Settings to enable"
        }
      >
        {isPending ? "Diagnosing…" : "Diagnose with Claude"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
