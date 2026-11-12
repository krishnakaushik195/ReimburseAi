import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageSkeleton, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { getReviewStats, getTenantPolicy, integrationStatus, listTenantClaims } from "@/lib/queries";
import { ACTIVE_STATUSES } from "@/lib/types";
import { ReviewGrid } from "./review-grid";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReviewQueue />
    </Suspense>
  );
}

async function ReviewQueue() {
  const user = await requireUser(["reviewer", "admin"]);
  const [rows, stats, policy] = await Promise.all([listTenantClaims(user.tenantId), getReviewStats(user.tenantId), getTenantPolicy(user.tenantId)]);
  const integrations = integrationStatus();
  const categories = Object.fromEntries(Object.entries(policy.categories).map(([key, rule]) => [key, rule.label]));
  const automationRate = stats.total ? Math.round((stats.autoApproved / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Review queue</h1>
          <p className="text-sm text-slate-500">
            {user.tenantName} · AI: {integrations.llm ?? "offline rules"} · Payouts:{" "}
            {integrations.paypal ?? (integrations.dryRun ? "simulated (dry run)" : "simulated PayPal")}
          </p>
        </div>
        <AutoRefresh active={rows.some((r) => ACTIVE_STATUSES.includes(r.status))} intervalMs={2500} maxTicks={40} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Needs review" value={stats.inReview} hint="Flagged by the agents" />
        <Stat label="Straight-through" value={`${automationRate}%`} hint={`${stats.autoApproved} of ${stats.total} claims without a human`} />
        <Stat label="Paid out" value={formatMoney(stats.paidTotal, policy.currency)} hint="Confirmed by PayPal" />
        <Stat label="Rejected" value={stats.rejected} hint="Duplicates, high risk or by reviewers" />
      </div>

      <ReviewGrid
        rows={rows}
        categories={categories}
        currency={policy.currency}
        adminApprovalAbove={policy.adminApprovalAbove}
        isAdmin={user.role === "admin"}
      />
    </div>
  );
}
