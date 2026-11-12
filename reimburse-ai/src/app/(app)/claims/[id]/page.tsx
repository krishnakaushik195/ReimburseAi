import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { OutcomeDot, RiskBadge, StatusBadge } from "@/components/badges";
import { Card, PageSkeleton } from "@/components/ui";
import type { DuplicateData, ExtractionData, PolicyData, ReconciliationData, RiskData, VerificationData } from "@/lib/agents/context";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { LlmUsage } from "@/lib/llm";
import { categoryLabel } from "@/lib/policy";
import { getClaimDetail } from "@/lib/queries";
import { ACTIVE_STATUSES, AGENT_LABELS, type AgentName, type AgentRunRow } from "@/lib/types";
import { PaymentActions, ReviewActions } from "./claim-actions";

export const metadata: Metadata = { title: "Claim" };

const TIMELINE: AgentName[] = ["ingestion", "extraction", "verification", "duplicate", "policy", "reconciliation", "risk", "orchestrator", "payment", "payment_recon"];
const TIMELINE_LABELS: Partial<Record<AgentName, string>> = { orchestrator: "Routing decision" };

export default function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClaimView params={params} />
    </Suspense>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function llmUsageOf(run: AgentRunRow | undefined): LlmUsage | null {
  return ((run?.data ?? null) as { llmUsage?: LlmUsage | null } | null)?.llmUsage ?? null;
}

function UsageLine({ usage }: { usage: LlmUsage }) {
  return (
    <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-800 ring-1 ring-violet-200">
      <span className="font-semibold">AI call</span>
      <span>· {usage.model}</span>
      <span>· {usage.input === "image+text" ? "image + OCR text" : "text only"}</span>
      {usage.totalTokens !== null && <span>· {usage.totalTokens.toLocaleString("en-US")} tokens</span>}
      <span>· {(usage.ms / 1000).toFixed(1)} s</span>
    </p>
  );
}

async function ClaimView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getClaimDetail(user, id);
  if (!detail) notFound();

  const { claim, runs, audit, policy } = detail;
  const latest = new Map<AgentName, AgentRunRow>();
  for (const run of runs) latest.set(run.agent, run);
  const dataOf = <T,>(agent: AgentName) => latest.get(agent)?.data as T | undefined;
  const extraction = dataOf<ExtractionData>("extraction");
  const verification = dataOf<VerificationData>("verification");
  const duplicate = dataOf<DuplicateData>("duplicate");
  const policyCheck = dataOf<PolicyData>("policy");
  const reconciliation = dataOf<ReconciliationData>("reconciliation");
  const risk = dataOf<RiskData>("risk");
  const aiCalls = runs.map(llmUsageOf).filter((usage): usage is LlmUsage => usage !== null);
  const aiTokens = aiCalls.reduce((sum, usage) => sum + (usage.totalTokens ?? 0), 0);

  const isStaff = user.role !== "claimant";
  const active = ACTIVE_STATUSES.includes(claim.status);
  const needsAdmin = claim.amount !== null && claim.amount > policy.adminApprovalAbove;
  const fileUrl = `/api/files/${claim.id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={isStaff ? "/review" : "/claims"} className="text-sm text-slate-500 hover:text-slate-800">
            ← {isStaff ? "Review queue" : "My claims"}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-slate-900">
            {claim.vendor ?? "Reading receipt…"}
            <span className="tabular-nums text-slate-500">{formatMoney(claim.amount, claim.currency)}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={claim.status} />
            <RiskBadge score={claim.risk_score} level={claim.risk_level} />
            {claim.human_verified && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">Reviewer-corrected</span>}
            <AutoRefresh active={active} />
          </div>
        </div>
        {claim.decision_note && (
          <div className="max-w-md rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Decision {detail.deciderName ? `by ${detail.deciderName}` : "by agents"}
              {claim.decided_at ? ` · ${formatDateTime(claim.decided_at)}` : ""}
            </p>
            <p className="mt-1 text-slate-800">{claim.decision_note}</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Card title="Claim details">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Startup">{detail.startupName}</Field>
              <Field label="Submitted by">{detail.submitterName}</Field>
              <Field label="Submitted">{formatDateTime(claim.created_at)}</Field>
              <Field label="Vendor">{claim.vendor ?? "—"}</Field>
              <Field label="Receipt date">{formatDate(claim.receipt_date)}</Field>
              <Field label="Category">{categoryLabel(policy, claim.category)}</Field>
              <Field label="Amount">{formatMoney(claim.amount, claim.currency)}</Field>
              <Field label="Declared by claimant">{formatMoney(claim.declared_amount, claim.currency)}</Field>
              <Field label="Invoice / receipt no.">{claim.invoice_number ?? "—"}</Field>
              <Field label="Extraction">
                {extraction ? `${extraction.method === "llm" ? "AI" : extraction.method === "reviewer" ? "Reviewer" : "Rule-based"} · ${Math.round((claim.confidence ?? 0) * 100)}%` : "—"}
              </Field>
              <Field label="AI calls">
                {aiCalls.length ? `${aiCalls.length} · ${aiTokens.toLocaleString("en-US")} tokens` : "None (rules only)"}
              </Field>
              <div className="col-span-2 sm:col-span-3">
                <Field label="Business purpose">{claim.purpose}</Field>
              </div>
            </dl>
          </Card>

          <Card title="Agent pipeline">
            <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-slate-200">
              {TIMELINE.map((agent) => {
                const run = latest.get(agent);
                const usage = llmUsageOf(run);
                return (
                  <li key={agent} className="relative flex gap-3">
                    <OutcomeDot outcome={run?.outcome ?? "pending"} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
                        {TIMELINE_LABELS[agent] ?? AGENT_LABELS[agent]}
                        {run && <span className="text-xs font-normal tabular-nums text-slate-400">{run.duration_ms} ms</span>}
                      </p>
                      <p className="text-sm text-slate-600">{run?.summary ?? (active ? "Waiting…" : "Not run")}</p>
                      {usage && <UsageLine usage={usage} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {risk && (
            <Card title="Risk assessment">
              <div className="flex items-start gap-5">
                <div className="text-center">
                  <p className="text-4xl font-black tabular-nums text-slate-900">{risk.score}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{risk.level} risk</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-800">{risk.rationale}</p>
                  <p className="mt-1 text-xs text-slate-400">{risk.rationaleSource === "llm" ? "Explanation written by AI; score computed by rules" : "Rule-based explanation"}</p>
                </div>
              </div>
              {risk.reasons.length > 0 && (
                <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                  {risk.reasons.map((reason, i) => (
                    <li key={`${reason.code}-${i}`} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className="text-slate-700">{reason.message}</span>
                      <span className={`shrink-0 font-semibold tabular-nums ${reason.weight > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {(verification || policyCheck || duplicate || reconciliation) && (
            <Card title="Findings">
              <div className="space-y-5 text-sm">
                {verification && (
                  <div>
                    <h3 className="font-semibold text-slate-900">Verification</h3>
                    <ul className="mt-2 space-y-1">
                      {verification.checks.map((check) => (
                        <li key={check.name} className="flex gap-2">
                          <span className={check.ok ? "text-emerald-600" : "text-rose-600"}>{check.ok ? "✓" : "✕"}</span>
                          <span>
                            <span className="font-medium text-slate-800">{check.name}:</span> <span className="text-slate-600">{check.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {policyCheck && (
                  <div>
                    <h3 className="font-semibold text-slate-900">Policy</h3>
                    {policyCheck.violations.length === 0 ? (
                      <p className="mt-1 text-emerald-700">Within the reimbursement policy.</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {policyCheck.violations.map((v) => (
                          <li key={v.rule} className="flex gap-2">
                            <span className={v.severity === "hard" ? "text-rose-600" : "text-amber-600"}>{v.severity === "hard" ? "✕" : "!"}</span>
                            <span className="text-slate-700">{v.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {duplicate && (
                  <div>
                    <h3 className="font-semibold text-slate-900">Duplicates</h3>
                    {duplicate.matches.length === 0 ? (
                      <p className="mt-1 text-emerald-700">No earlier claim matches this receipt.</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {duplicate.matches.map((m) => (
                          <li key={m.claimId} className="flex flex-wrap gap-2">
                            <span className="text-rose-600">✕</span>
                            <span className="text-slate-700">{m.reason}</span>
                            {isStaff && (
                              <Link href={`/claims/${m.claimId}`} className="text-blue-600 hover:underline">
                                view claim ({m.status.toLowerCase().replace(/_/g, " ")})
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {reconciliation && (
                  <div>
                    <h3 className="font-semibold text-slate-900">Reconciliation</h3>
                    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Grant budget">{formatMoney(reconciliation.budget.total, policy.currency)}</Field>
                      <Field label="Already committed">{formatMoney(reconciliation.budget.committed, policy.currency)}</Field>
                      <Field label="Remaining">{formatMoney(reconciliation.budget.remaining, policy.currency)}</Field>
                      <Field label="After this claim">{formatMoney(reconciliation.budget.remainingAfter, policy.currency)}</Field>
                    </dl>
                    <p className="mt-2 text-slate-700">
                      {reconciliation.transaction.matched
                        ? `Bank feed: "${reconciliation.transaction.description}" on ${formatDate(reconciliation.transaction.postedOn)} for ${formatMoney(reconciliation.transaction.amount ?? null, policy.currency)}${
                            reconciliation.transaction.alreadyClaimedBy ? " — already linked to another claim" : ""
                          }`
                        : "Bank feed: no matching card or bank transaction."}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="Audit trail">
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {audit.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-4">
                  <span>
                    <span className={`font-mono text-xs ${entry.actor.startsWith("agent:") ? "text-sky-700" : "text-violet-700"}`}>{entry.actor}</span>{" "}
                    <span className="text-slate-800">{entry.action}</span>
                    {typeof entry.details?.summary === "string" && <span className="text-slate-500"> — {entry.details.summary}</span>}
                    {typeof entry.details?.note === "string" && <span className="text-slate-500"> — “{entry.details.note}”</span>}
                    {typeof entry.details?.field === "string" && (
                      <span className="text-slate-500">
                        {" "}
                        — {entry.details.field}: {String(entry.details.from ?? "—")} → {String(entry.details.to)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-5">
          {isStaff && claim.status === "IN_REVIEW" && (
            <Card title="Your decision">
              <ReviewActions
                claimId={claim.id}
                hint={
                  needsAdmin
                    ? `Above ${formatMoney(policy.adminApprovalAbove, policy.currency)}: ${user.role === "admin" ? "admin approval (you)" : "needs an admin to approve"}.`
                    : "Correct extracted values in the review queue grid before approving if needed."
                }
              />
            </Card>
          )}

          {(claim.payout_batch_id || claim.status === "PAYMENT_FAILED") && (
            <Card title="Payment">
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Payee">{detail.payeeEmail}</Field>
                <Field label="Provider">{claim.payout_provider === "paypal" ? "PayPal Payouts" : claim.payout_provider === "simulated" ? "Simulated PayPal" : "—"}</Field>
                <Field label="PayPal status">{claim.payout_status ?? "—"}</Field>
                <Field label="Paid at">{formatDateTime(claim.paid_at)}</Field>
                <div className="col-span-2">
                  <Field label="Payout batch">
                    <code className="break-all text-xs">{claim.payout_batch_id ?? "—"}</code>
                  </Field>
                </div>
              </dl>
              {isStaff && (
                <div className="mt-4">
                  <PaymentActions claimId={claim.id} status={claim.status} isAdmin={user.role === "admin"} />
                </div>
              )}
            </Card>
          )}

          <Card title="Receipt" actions={<a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:underline">Open original</a>}>
            <p className="mb-3 truncate text-xs text-slate-500">{claim.file_name}</p>
            {claim.file_mime.startsWith("image/") ? (
              <Image src={fileUrl} alt="Uploaded receipt" width={900} height={1200} unoptimized loading="eager" className="h-auto w-full rounded-lg border border-slate-200" />
            ) : claim.file_mime === "application/pdf" ? (
              <iframe src={fileUrl} title="Uploaded receipt" className="h-[640px] w-full rounded-lg border border-slate-200" />
            ) : (
              <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-xs text-slate-800">{claim.ocr_text ?? "Loading…"}</pre>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
