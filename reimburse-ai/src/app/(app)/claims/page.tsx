import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { Card, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { categoryLabel } from "@/lib/policy";
import { getTenantPolicy, listNotifications, listStartupClaims } from "@/lib/queries";
import { ACTIVE_STATUSES } from "@/lib/types";

export const metadata: Metadata = { title: "My claims" };

export default function ClaimsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyClaims />
    </Suspense>
  );
}

async function MyClaims() {
  const user = await requireUser(["claimant"]);
  const [claims, notifications, policy] = await Promise.all([listStartupClaims(user), listNotifications(user), getTenantPolicy(user.tenantId)]);
  const active = claims.some((c) => ACTIVE_STATUSES.includes(c.status));
  const paid = claims.filter((c) => c.status === "PAID").reduce((sum, c) => sum + (c.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My claims</h1>
          <p className="text-sm text-slate-500">
            {user.startupName} · reimbursed so far {formatMoney(paid, policy.currency)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh active={active} />
          <Link href="/claims/new" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
            Submit a claim
          </Link>
        </div>
      </div>

      {notifications.length > 0 && (
        <Card title="Updates">
          <ul className="divide-y divide-slate-100">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-4 py-2 text-sm">
                <span className="text-slate-700">
                  {n.claimId ? (
                    <Link href={`/claims/${n.claimId}`} className="hover:underline">
                      {n.message}
                    </Link>
                  ) : (
                    n.message
                  )}
                </span>
                <span className="shrink-0 text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Claims (${claims.length})`}>
        {claims.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-500">No claims yet.</p>
            <Link href="/claims/new" className="mt-3 inline-block text-sm font-semibold text-blue-600 hover:underline">
              Upload your first receipt →
            </Link>
          </div>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Submitted</th>
                  <th className="px-5 py-3">Vendor</th>
                  <th className="px-5 py-3">Receipt date</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3">Risk</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDateTime(c.createdAt)}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      <Link href={`/claims/${c.id}`} className="hover:text-blue-700 hover:underline">
                        {c.vendor ?? "Reading receipt…"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(c.receiptDate)}</td>
                    <td className="px-5 py-3 text-slate-600">{categoryLabel(policy, c.category)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(c.amount, c.currency)}</td>
                    <td className="px-5 py-3">
                      <RiskBadge score={c.riskScore} level={c.riskLevel} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
