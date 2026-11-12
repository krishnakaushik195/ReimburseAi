import "server-only";
import { formatMoney } from "../format";
import { containsWord, daysBetween, todayIso } from "../text";
import type { AgentResult, RiskSignal } from "../types";
import { receiptOf, type PipelineContext, type PolicyData, type PolicyViolation } from "./context";

/** Agent 5 — applies the tenant's configurable reimbursement policy. */
export async function runPolicyCheck(ctx: PipelineContext): Promise<AgentResult<PolicyData>> {
  const policy = ctx.tenant.policy;
  const receipt = receiptOf(ctx);
  const violations: PolicyViolation[] = [];

  const rule = policy.categories[receipt.category];
  if (!rule) {
    violations.push({ rule: "category", severity: "hard", message: `Category "${receipt.category}" is not covered by the policy` });
  } else if (receipt.total !== null && receipt.total > rule.limit) {
    violations.push({
      rule: "category_limit",
      severity: "hard",
      message: `${formatMoney(receipt.total, receipt.currency)} exceeds the ${rule.label} limit of ${formatMoney(rule.limit, policy.currency)}`,
    });
  }

  if (receipt.date && receipt.date <= todayIso()) {
    const age = daysBetween(receipt.date, todayIso());
    if (age > policy.maxClaimAgeDays) {
      violations.push({ rule: "claim_age", severity: "hard", message: `Receipt is ${age} days old (limit ${policy.maxClaimAgeDays} days)` });
    }
  }

  if (receipt.currency && receipt.currency !== policy.currency) {
    violations.push({
      rule: "currency",
      severity: "soft",
      message: `Receipt is in ${receipt.currency}; policy pays in ${policy.currency}`,
    });
  }

  const searchable = [receipt.vendor, ...receipt.lineItems.map((item) => item.description), ctx.text].filter(Boolean).join("\n");
  const blocked = policy.blockedKeywords.filter((keyword) => containsWord(searchable, keyword));
  if (blocked.length) {
    violations.push({ rule: "blocked_items", severity: "hard", message: `Contains non-reimbursable items: ${blocked.join(", ")}` });
  }

  if (ctx.claim.purpose.trim().length < policy.minPurposeLength) {
    violations.push({ rule: "purpose", severity: "soft", message: "Business purpose is missing or too short" });
  }

  const signals: RiskSignal[] = violations.map((v) => ({
    code: `policy_${v.rule}`,
    kind: "policy",
    weight: v.severity === "hard" ? 25 : 10,
    message: v.message,
  }));

  return {
    outcome: violations.length ? "flag" : "pass",
    summary: violations.length ? `${violations.length} violation(s) — ${violations[0].message}` : "Within policy",
    data: { violations },
    signals,
  };
}
