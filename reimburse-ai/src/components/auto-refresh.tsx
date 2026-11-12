"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page on an interval while agents are still working on a claim. */
export function AutoRefresh({ active, intervalMs = 1500, maxTicks = 80 }: { active: boolean; intervalMs?: number; maxTicks?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, maxTicks, router]);

  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
      <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
      Agents working — live
    </span>
  );
}
