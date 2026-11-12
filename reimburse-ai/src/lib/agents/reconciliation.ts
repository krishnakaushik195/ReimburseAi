import "server-only";
import { query, queryOne } from "../db";
import { formatDate, formatMoney } from "../format";
import { roundMoney, similarity } from "../text";
import type { AgentResult, RiskSignal } from "../types";
import { receiptOf, type PipelineContext, type ReconciliationData } from "./context";

/** Agent 6 — checks the startup's remaining budget and matches the claim to its bank / card feed. */
export async function runReconciliation(ctx: PipelineContext): Promise<AgentResult<ReconciliationData>> {
  const { claim, startup } = ctx;
  const receipt = receiptOf(ctx);
  const amount = receipt.total ?? 0;
  const signals: RiskSignal[] = [];

  const committedRow = await queryOne<{ committed: number }>(
    `SELECT COALESCE(sum(amount), 0)::float8 AS committed
       FROM claims
      WHERE startup_id = $1 AND id <> $2 AND status IN ('AUTO_APPROVED', 'APPROVED', 'PAYING', 'PAID')`,
    [startup.id, claim.id],
  );
  const committed = roundMoney(committedRow?.committed ?? 0);
  const remaining = roundMoney(startup.budget_total - committed);
  const budget = { total: startup.budget_total, committed, remaining, remainingAfter: roundMoney(remaining - amount) };
  if (amount > remaining) {
    signals.push({
      code: "over_budget",
      kind: "financial",
      weight: 20,
      message: `Exceeds the remaining budget of ${formatMoney(remaining, ctx.tenant.policy.currency)}`,
    });
  }

  let transaction: ReconciliationData["transaction"] = { matched: false };
  let linkedTransactionId: string | null = null;
  if (receipt.total !== null) {
    const params: unknown[] = [startup.id, receipt.total];
    if (receipt.date) params.push(receipt.date);
    const candidates = await query<{ id: string; posted_on: string; description: string; amount: number }>(
      `SELECT id, posted_on, description, amount
         FROM bank_transactions
        WHERE startup_id = $1 AND abs(amount - $2) <= 0.01
          ${receipt.date ? "AND posted_on BETWEEN $3::date - 5 AND $3::date + 5" : ""}
        ORDER BY posted_on DESC
        LIMIT 20`,
      params,
    );
    const ranked = candidates
      .map((candidate) => ({ candidate, score: similarity(receipt.vendor, candidate.description) }))
      .sort((a, b) => b.score - a.score);
    // A lone same-amount transaction within ±5 days is accepted even if the bank descriptor is cryptic.
    const best = ranked.find((r) => r.score >= 0.2) ?? (ranked.length === 1 && receipt.date ? ranked[0] : undefined);

    if (best) {
      const other = await queryOne<{ id: string }>(
        "SELECT id FROM claims WHERE matched_transaction_id = $1 AND id <> $2 AND status <> 'REJECTED' LIMIT 1",
        [best.candidate.id, claim.id],
      );
      transaction = {
        matched: true,
        id: best.candidate.id,
        description: best.candidate.description,
        postedOn: best.candidate.posted_on,
        amount: best.candidate.amount,
        alreadyClaimedBy: other?.id ?? null,
      };
      if (other) {
        signals.push({
          code: "transaction_already_claimed",
          kind: "integrity",
          weight: 45,
          message: "The matching bank transaction is already linked to another claim",
        });
      } else {
        linkedTransactionId = best.candidate.id;
        signals.push({
          code: "transaction_matched",
          kind: "financial",
          weight: -10,
          message: `Matches bank transaction "${best.candidate.description}" on ${formatDate(best.candidate.posted_on)}`,
        });
      }
    }
  }
  if (!transaction.matched) {
    signals.push({ code: "no_transaction_match", kind: "financial", weight: 10, message: "No matching card or bank transaction found" });
  }
  if (linkedTransactionId !== claim.matched_transaction_id) {
    await query("UPDATE claims SET matched_transaction_id = $2 WHERE id = $1", [claim.id, linkedTransactionId]);
    claim.matched_transaction_id = linkedTransactionId;
  }

  return {
    outcome: signals.some((s) => s.weight > 0) ? "flag" : "pass",
    summary: `Budget left after this claim: ${formatMoney(budget.remainingAfter, ctx.tenant.policy.currency)} · ${
      transaction.matched ? `bank match "${transaction.description}"` : "no bank match"
    }`,
    data: { budget, transaction },
    signals,
  };
}
