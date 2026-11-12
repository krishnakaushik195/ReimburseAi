import { statusLabel } from "@/lib/format";
import type { ClaimStatus, Outcome, RiskLevel } from "@/lib/types";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  SUBMITTED: "bg-slate-100 text-slate-700 ring-slate-300",
  EXTRACTED: "bg-sky-50 text-sky-700 ring-sky-200",
  VERIFIED: "bg-sky-50 text-sky-700 ring-sky-200",
  DEDUP_CHECKED: "bg-sky-50 text-sky-700 ring-sky-200",
  POLICY_CHECKED: "bg-sky-50 text-sky-700 ring-sky-200",
  RECONCILED: "bg-sky-50 text-sky-700 ring-sky-200",
  SCORED: "bg-sky-50 text-sky-700 ring-sky-200",
  AUTO_APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  IN_REVIEW: "bg-amber-50 text-amber-800 ring-amber-300",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  PAYING: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  PAID: "bg-emerald-600 text-white ring-emerald-600",
  PAYMENT_FAILED: "bg-rose-600 text-white ring-rose-600",
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[status] ?? STATUS_STYLES.SUBMITTED}`}
    >
      {statusLabel(status)}
    </span>
  );
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-rose-100 text-rose-800",
};

/** Risk score pill; `compact` drops the "Risk" prefix for table cells that already have a Risk header. */
export function RiskBadge({ score, level, compact = false }: { score: number | null; level: RiskLevel | null; compact?: boolean }) {
  if (score === null || !level) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span
      title={`Risk score ${score}/100 (${level})`}
      className={`inline-flex min-w-11 items-center justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${RISK_STYLES[level]}`}
    >
      {compact ? score : `Risk ${score}`}
    </span>
  );
}

const OUTCOME_STYLES: Record<Outcome | "pending", { icon: string; className: string; label: string }> = {
  pass: { icon: "✓", className: "bg-emerald-600 text-white", label: "Passed" },
  flag: { icon: "!", className: "bg-amber-500 text-white", label: "Flagged" },
  fail: { icon: "✕", className: "bg-rose-600 text-white", label: "Failed" },
  pending: { icon: "", className: "bg-slate-200 text-slate-500", label: "Pending" },
};

export function OutcomeDot({ outcome }: { outcome: Outcome | "pending" }) {
  const style = OUTCOME_STYLES[outcome];
  return (
    <span
      title={style.label}
      aria-label={style.label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.className}`}
    >
      {style.icon}
    </span>
  );
}
