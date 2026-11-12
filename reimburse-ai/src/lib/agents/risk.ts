import "server-only";
import { explainRisk, getLlm, type LlmUsage } from "../llm";
import type { AgentResult, RiskLevel, RiskSignal } from "../types";
import { receiptOf, type PipelineContext, type PipelineResults, type RiskData } from "./context";

const BASE_RISK = 5;
const SIGNAL_SOURCES: (keyof PipelineResults)[] = ["ingestion", "extraction", "verification", "duplicate", "policy", "reconciliation"];

function templateRationale(score: number, level: RiskLevel, reasons: RiskSignal[]): string {
  const positive = reasons.filter((r) => r.weight > 0);
  if (!positive.length) {
    return `Risk ${score}/100 (${level}). No issues found: the receipt is consistent, within policy and matches the bank feed.`;
  }
  const top = positive.slice(0, 3).map((r) => r.message.charAt(0).toLowerCase() + r.message.slice(1));
  return `Risk ${score}/100 (${level}), mainly because ${top.join("; ")}.`;
}

/** Agent 7 — combines every finding into one explainable 0–100 score. Rules decide; the LLM only explains. */
export async function runRiskScoring(ctx: PipelineContext): Promise<AgentResult<RiskData>> {
  const policy = ctx.tenant.policy;
  const all = SIGNAL_SOURCES.flatMap((source) => ctx.results[source]?.signals ?? []);
  // After a reviewer corrects the fields, "could not read" findings no longer apply.
  const considered = ctx.claim.human_verified ? all.filter((s) => s.kind !== "quality") : all;

  const quality = considered.filter((s) => s.kind === "quality").reduce((sum, s) => sum + s.weight, 0);
  const other = considered.filter((s) => s.kind !== "quality").reduce((sum, s) => sum + s.weight, 0);
  // Data-quality problems alone may send a claim to review, but never to automatic rejection.
  const qualityCap = Math.max(0, policy.rejectMinRisk - BASE_RISK - 1);
  const score = Math.max(0, Math.min(100, Math.round(BASE_RISK + Math.min(quality, qualityCap) + other)));
  const level: RiskLevel = score <= policy.autoApproveMaxRisk ? "low" : score >= policy.rejectMinRisk ? "high" : "medium";
  const reasons = [...considered].sort((a, b) => b.weight - a.weight);

  let rationale = templateRationale(score, level, reasons);
  let rationaleSource: RiskData["rationaleSource"] = "template";
  let llmUsage: LlmUsage | null = null;
  if (getLlm()) {
    try {
      const receipt = receiptOf(ctx);
      const result = await explainRisk({ score, level, vendor: receipt.vendor, amount: receipt.total, currency: receipt.currency, signals: reasons });
      llmUsage = result.usage;
      if (result.text) {
        rationale = result.text;
        rationaleSource = "llm";
      }
    } catch {
      // The template rationale is a complete fallback.
    }
  }

  return {
    outcome: level === "low" ? "pass" : level === "medium" ? "flag" : "fail",
    summary: `Risk ${score}/100 (${level}) from ${reasons.filter((r) => r.weight > 0).length} finding(s)`,
    data: { score, level, reasons, rationale, rationaleSource, llmUsage },
    signals: [],
  };
}
