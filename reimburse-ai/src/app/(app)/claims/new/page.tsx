import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { getTenantPolicy } from "@/lib/queries";
import { NewClaimForm } from "./new-claim-form";

export const metadata: Metadata = { title: "Submit a claim" };

const STEPS = [
  ["Ingestion", "Reads your PDF, photo or text receipt (OCR when needed)."],
  ["Extraction", "Finds vendor, date, amounts, tax, currency and category."],
  ["Verification", "Checks totals, dates and that values really appear on the document."],
  ["Duplicate detection", "Makes sure this receipt was not claimed before."],
  ["Policy validation", "Applies your funder's reimbursement rules."],
  ["Reconciliation", "Checks your remaining budget and matches your bank feed."],
  ["Risk scoring", "Low risk is approved automatically; the rest goes to a reviewer."],
  ["PayPal payout", "Approved claims are paid to your registered PayPal account."],
];

export default function NewClaimPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewClaim />
    </Suspense>
  );
}

async function NewClaim() {
  const user = await requireUser(["claimant"]);
  const policy = await getTenantPolicy(user.tenantId);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h1 className="text-2xl font-bold text-slate-900">Submit a claim</h1>
        <p className="mt-1 text-sm text-slate-500">
          Claims up to {formatMoney(policy.autoApproveMaxAmount, policy.currency)} with a low risk score are approved and paid automatically.
        </p>
        <Card className="mt-6">
          <NewClaimForm currency={policy.currency} />
        </Card>
      </div>
      <div className="lg:col-span-2">
        <Card title="What happens next">
          <ol className="space-y-3">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{i + 1}</span>
                <span className="text-sm">
                  <span className="font-semibold text-slate-900">{title}.</span> <span className="text-slate-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
