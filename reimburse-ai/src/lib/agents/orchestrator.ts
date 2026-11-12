import "server-only";
import { audit, notify } from "../audit";
import { json, query, queryOne } from "../db";
import { formatMoney, statusLabel } from "../format";
import { getLlm } from "../llm";
import { parsePolicy } from "../policy";
import { readUpload } from "../storage";
import { AGENT_LABELS, type AgentName, type ClaimRow, type ClaimStatus, type ExtractedReceipt, type RiskSignal, type StartupRow } from "../types";
import type { IngestionData, PipelineContext, PipelineResults } from "./context";
import { runDuplicateCheck } from "./duplicate";
import { runExtraction } from "./extraction";
import { runIngestion } from "./ingestion";
import { payClaim } from "./payment";
import { runPolicyCheck } from "./policy-check";
import { runReconciliation } from "./reconciliation";
import { runRiskScoring } from "./risk";
import { recordRun } from "./runs";
import { runVerification } from "./verification";

/**
 * Orchestrator agent: runs the specialist agents in order, moves the claim through its
 * states, and routes it to auto-approval, human review or rejection.
 */

class AgentFailure extends Error {
  agent: AgentName;
  constructor(agent: AgentName, message: string) {
    super(message);
    this.agent = agent;
  }
}

type Decision = { status: "AUTO_APPROVED" | "IN_REVIEW" | "REJECTED"; reason: string };

async function loadContext(claimId: string, withFile: boolean): Promise<PipelineContext | null> {
  const claim = await queryOne<ClaimRow>("SELECT * FROM claims WHERE id = $1", [claimId]);
  if (!claim) return null;
  const tenant = await queryOne<{ id: string; name: string; policy: unknown }>("SELECT id, name, policy FROM tenants WHERE id = $1", [
    claim.tenant_id,
  ]);
  const startup = await queryOne<StartupRow>("SELECT id, tenant_id, name, paypal_email, budget_total FROM startups WHERE id = $1", [
    claim.startup_id,
  ]);
  if (!tenant || !startup) return null;
  return {
    claim,
    startup,
    tenant: { id: tenant.id, name: tenant.name, policy: parsePolicy(tenant.policy) },
    file: withFile ? { buffer: await readUpload(claim.tenant_id, claim.id, claim.file_mime), mime: claim.file_mime } : undefined,
    text: claim.ocr_text ?? "",
    results: {},
  };
}

async function step<K extends keyof PipelineResults>(
  ctx: PipelineContext,
  agent: K,
  run: (ctx: PipelineContext) => Promise<PipelineResults[K]>,
  nextStatus: ClaimStatus | null,
  persist?: (data: PipelineResults[K]["data"]) => unknown,
): Promise<PipelineResults[K]> {
  const started = performance.now();
  let result: PipelineResults[K];
  try {
    result = await run(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRun(ctx.claim, agent, "fail", `Agent error: ${message}`, null, [], performance.now() - started);
    throw new AgentFailure(agent, message);
  }
  ctx.results[agent] = result;
  await recordRun(ctx.claim, agent, result.outcome, result.summary, persist ? persist(result.data) : result.data, result.signals, performance.now() - started);
  if (nextStatus) await query("UPDATE claims SET status = $2, updated_at = now() WHERE id = $1", [ctx.claim.id, nextStatus]);
  return result;
}

async function saveExtraction(ctx: PipelineContext, receipt: ExtractedReceipt): Promise<void> {
  await query(
    `UPDATE claims
        SET status = 'EXTRACTED', ocr_text = $2, vendor = $3, receipt_date = $4, amount = $5, currency = $6,
            category = $7, invoice_number = $8, extracted = $9::jsonb, confidence = $10, updated_at = now()
      WHERE id = $1`,
    [
      ctx.claim.id,
      ctx.text.slice(0, 50_000),
      receipt.vendor,
      receipt.date,
      receipt.total,
      receipt.currency,
      receipt.category,
      receipt.invoiceNumber,
      json(receipt),
      receipt.confidence,
    ],
  );
  Object.assign(ctx.claim, {
    ocr_text: ctx.text,
    vendor: receipt.vendor,
    receipt_date: receipt.date,
    amount: receipt.total,
    currency: receipt.currency,
    category: receipt.category,
    invoice_number: receipt.invoiceNumber,
    extracted: receipt,
    confidence: receipt.confidence,
  });
}

async function saveScore(ctx: PipelineContext, status: ClaimStatus | null): Promise<void> {
  const risk = ctx.results.risk?.data;
  if (!risk) return;
  const flags = risk.reasons.filter((r) => r.weight > 0).slice(0, 6).map((r) => r.message);
  await query(
    `UPDATE claims SET status = COALESCE($5::text, status), risk_score = $2, risk_level = $3, flags = $4::jsonb, updated_at = now()
      WHERE id = $1`,
    [ctx.claim.id, risk.score, risk.level, json(flags), status],
  );
}

function route(ctx: PipelineContext): Decision {
  const { policy } = ctx.tenant;
  const { duplicate, verification, risk } = ctx.results;
  const riskData = risk?.data;
  if (!riskData) return { status: "IN_REVIEW", reason: "Risk score unavailable" };

  if (duplicate?.outcome === "fail") return { status: "REJECTED", reason: duplicate.summary };
  if (riskData.level === "high") return { status: "REJECTED", reason: `High risk score (${riskData.score}/100)` };

  const reasons: string[] = [];
  if (verification?.data.lowConfidence) reasons.push("low extraction confidence");
  if (ctx.results.policy?.data.violations.length) reasons.push("policy violation");
  if (duplicate?.outcome === "flag") reasons.push("possible duplicate");
  if (riskData.level === "medium") reasons.push(`medium risk score (${riskData.score}/100)`);
  const amount = ctx.claim.amount ?? 0;
  if (amount <= 0) reasons.push("no payable amount");
  else if (amount > policy.autoApproveMaxAmount) {
    reasons.push(`amount above the ${formatMoney(policy.autoApproveMaxAmount, policy.currency)} auto-approval limit`);
  }

  if (reasons.length) {
    const text = reasons.join(", ");
    return { status: "IN_REVIEW", reason: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  return { status: "AUTO_APPROVED", reason: `Low risk (${riskData.score}/100) and within policy` };
}

/** Full pipeline for a newly submitted claim. Safe to call more than once: only SUBMITTED claims are processed. */
export async function processClaim(claimId: string): Promise<void> {
  const ctx = await loadContext(claimId, true);
  if (!ctx || ctx.claim.status !== "SUBMITTED") return;
  const { claim } = ctx;
  const started = performance.now();
  await audit({
    tenantId: claim.tenant_id,
    claimId,
    actor: "agent:orchestrator",
    action: "pipeline.started",
    details: { mode: getLlm() ? "ai" : "offline" },
  });

  try {
    const ingestion = await step(ctx, "ingestion", runIngestion, null, ({ text, ...rest }) => ({ ...rest, characters: text.length }));
    // Postgres text and jsonb cannot store NUL characters.
    ctx.text = ingestion.data.text.replaceAll(String.fromCharCode(0), "");
    const extraction = await step(ctx, "extraction", runExtraction, null);
    await saveExtraction(ctx, extraction.data.receipt);
    await step(ctx, "verification", runVerification, "VERIFIED");
    await step(ctx, "duplicate", runDuplicateCheck, "DEDUP_CHECKED");
    await step(ctx, "policy", runPolicyCheck, "POLICY_CHECKED");
    await step(ctx, "reconciliation", runReconciliation, "RECONCILED");
    await step(ctx, "risk", runRiskScoring, null);
    await saveScore(ctx, "SCORED");
  } catch (error) {
    const agent: AgentName = error instanceof AgentFailure ? error.agent : "orchestrator";
    const message = error instanceof Error ? error.message : String(error);
    await query(
      "UPDATE claims SET status = 'IN_REVIEW', review_required = true, flags = $2::jsonb, decision_note = $3, updated_at = now() WHERE id = $1",
      [claimId, json([`${AGENT_LABELS[agent]} failed: ${message}`]), "Automated processing stopped; manual review needed"],
    );
    await recordRun(claim, "orchestrator", "flag", `Stopped at ${AGENT_LABELS[agent]}; sent to human review`, { error: message }, [], performance.now() - started);
    await notify({ tenantId: claim.tenant_id, startupId: claim.startup_id, claimId, message: `Your claim "${claim.file_name}" needs a manual review.` });
    return;
  }

  const decision = route(ctx);
  await query(
    `UPDATE claims
        SET status = $2::text, review_required = $3, decision_note = $4,
            decided_at = CASE WHEN $2::text IN ('AUTO_APPROVED', 'REJECTED') THEN now() END, updated_at = now()
      WHERE id = $1`,
    [claimId, decision.status, decision.status === "IN_REVIEW", decision.reason],
  );
  await recordRun(
    claim,
    "orchestrator",
    decision.status === "AUTO_APPROVED" ? "pass" : decision.status === "IN_REVIEW" ? "flag" : "fail",
    `Routed to ${statusLabel(decision.status)} — ${decision.reason}`,
    decision,
    [],
    performance.now() - started,
  );

  const what = `${ctx.claim.vendor ?? "expense"} claim for ${formatMoney(ctx.claim.amount, ctx.claim.currency)}`;
  const message =
    decision.status === "AUTO_APPROVED"
      ? `Your ${what} was approved automatically. Payment is on its way.`
      : decision.status === "IN_REVIEW"
        ? `Your ${what} is with a reviewer: ${decision.reason}.`
        : `Your ${what} was rejected: ${decision.reason}.`;
  await notify({ tenantId: claim.tenant_id, startupId: claim.startup_id, claimId, message });

  if (decision.status === "AUTO_APPROVED") await payClaim(claimId, "agent:orchestrator");
}

const EMPTY_RECEIPT: ExtractedReceipt = {
  vendor: null,
  date: null,
  currency: null,
  total: null,
  subtotal: null,
  tax: null,
  invoiceNumber: null,
  category: "other",
  lineItems: [],
  confidence: 0,
};

/** Re-runs the checks after a reviewer corrects fields. The claim stays in review; only findings and score change. */
export async function recheckClaim(claimId: string): Promise<void> {
  const ctx = await loadContext(claimId, false);
  if (!ctx || ctx.claim.status !== "IN_REVIEW") return;
  const started = performance.now();

  const ingestion = await queryOne<{ data: Omit<IngestionData, "text"> | null; signals: RiskSignal[] }>(
    "SELECT data, signals FROM agent_runs WHERE claim_id = $1 AND agent = 'ingestion' ORDER BY id DESC LIMIT 1",
    [claimId],
  );
  if (ingestion?.data) {
    ctx.results.ingestion = { outcome: "pass", summary: "", data: { ...ingestion.data, text: ctx.text }, signals: ingestion.signals };
  }
  const { claim } = ctx;
  const receipt: ExtractedReceipt = {
    ...(claim.extracted ?? EMPTY_RECEIPT),
    vendor: claim.vendor,
    date: claim.receipt_date,
    total: claim.amount,
    currency: claim.currency,
    category: claim.category ?? "other",
    invoiceNumber: claim.invoice_number,
    confidence: claim.human_verified ? 1 : (claim.confidence ?? 0),
  };
  ctx.results.extraction = {
    outcome: "pass",
    summary: "Reviewer-corrected values",
    data: { receipt, method: "reviewer", llmError: null, llmUsage: null },
    signals: [],
  };

  try {
    await step(ctx, "verification", runVerification, null);
    await step(ctx, "duplicate", runDuplicateCheck, null);
    await step(ctx, "policy", runPolicyCheck, null);
    await step(ctx, "reconciliation", runReconciliation, null);
    const risk = await step(ctx, "risk", runRiskScoring, null);
    await saveScore(ctx, null);
    await recordRun(claim, "orchestrator", "flag", `Re-checked after reviewer edits — risk now ${risk.data.score}/100`, null, [], performance.now() - started);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRun(claim, "orchestrator", "flag", `Re-check stopped: ${message}`, null, [], performance.now() - started);
  }
}
