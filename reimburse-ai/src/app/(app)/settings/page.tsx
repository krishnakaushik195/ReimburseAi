import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { getTenantPolicy, integrationStatus, listStartups } from "@/lib/queries";
import { PolicyForm, StartupForm } from "./settings-forms";

export const metadata: Metadata = { title: "Policy & payees" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{children}</span>
  );
}

async function Settings() {
  const user = await requireUser(["admin"]);
  const [policy, startups] = await Promise.all([getTenantPolicy(user.tenantId), listStartups(user.tenantId)]);
  const integrations = integrationStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Policy & payees</h1>
        <p className="text-sm text-slate-500">{user.tenantName} · each organization has its own rules, thresholds and payees.</p>
      </div>

      <Card title="Integrations">
        <div className="flex flex-wrap gap-6 text-sm">
          <p className="flex items-center gap-2">
            AI extraction{" "}
            <Pill ok={Boolean(integrations.llm)}>
              {integrations.llm ?? (integrations.llmDisabled ? "Off — AGENT_LLM_ENABLED=false" : "Offline rules — set Azure OpenAI or OPENAI_API_KEY")}
            </Pill>
          </p>
          <p className="flex items-center gap-2">
            Payouts{" "}
            <Pill ok={Boolean(integrations.paypal)}>
              {integrations.paypal ?? (integrations.dryRun ? "Simulated — AGENT_DRY_RUN=true" : "Simulated — set PAYPAL_CLIENT_ID / SECRET")}
            </Pill>
          </p>
          <p className="flex items-center gap-2">
            Webhooks <Pill ok={integrations.webhook}>{integrations.webhook ? "Verified PayPal webhooks" : "Off — use Sync PayPal"}</Pill>
          </p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Reimbursement policy (JSON)">
            <PolicyForm initial={JSON.stringify(policy, null, 2)} />
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card title="How the policy is used">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
              <li>
                <strong>autoApproveMaxRisk</strong> ({policy.autoApproveMaxRisk}) and <strong>autoApproveMaxAmount</strong> (
                {formatMoney(policy.autoApproveMaxAmount, policy.currency)}) decide straight-through payment.
              </li>
              <li>
                Risk at or above <strong>rejectMinRisk</strong> ({policy.rejectMinRisk}) is rejected automatically.
              </li>
              <li>
                Claims above <strong>adminApprovalAbove</strong> ({formatMoney(policy.adminApprovalAbove, policy.currency)}) need an admin.
              </li>
              <li>
                <strong>categories</strong> set per-claim limits and keywords for the extraction agent; <strong>blockedKeywords</strong> are never
                reimbursed.
              </li>
            </ul>
          </Card>
          <Card title="Payees & grant budgets">
            <div className="space-y-5">
              {startups.map((s) => (
                <div key={s.id}>
                  <div className="flex items-baseline justify-between">
                    <p className="font-semibold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatMoney(s.committed, policy.currency)} committed · {formatMoney(s.paid, policy.currency)} paid
                    </p>
                  </div>
                  <StartupForm id={s.id} paypalEmail={s.paypalEmail} budgetTotal={s.budgetTotal} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
