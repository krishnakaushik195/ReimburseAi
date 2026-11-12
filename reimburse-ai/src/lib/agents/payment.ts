import "server-only";
import { notify } from "../audit";
import { query, queryOne } from "../db";
import { formatMoney } from "../format";
import { createPayout } from "../paypal";
import type { ClaimRow, StartupRow } from "../types";
import { reconcilePayment } from "./payment-recon";
import { recordRun } from "./runs";

/** Agent 8 — sends an approved claim's money to the startup's registered PayPal account. */
export async function payClaim(claimId: string, initiatedBy: string): Promise<void> {
  // Only one caller can move a claim from approved to PAYING, which prevents double payouts.
  const claim = await queryOne<ClaimRow>(
    `UPDATE claims SET status = 'PAYING', payout_attempts = payout_attempts + 1, updated_at = now()
      WHERE id = $1 AND status IN ('AUTO_APPROVED', 'APPROVED')
      RETURNING *`,
    [claimId],
  );
  if (!claim) return;
  const started = performance.now();

  try {
    const startup = await queryOne<StartupRow>("SELECT id, tenant_id, name, paypal_email, budget_total FROM startups WHERE id = $1", [
      claim.startup_id,
    ]);
    if (!startup) throw new Error("Payee not found");
    if (claim.amount === null || claim.amount <= 0) throw new Error("Claim has no payable amount");

    // The payee always comes from the startup's registered account, never from the receipt or the request.
    const payout = await createPayout({
      senderBatchId: `RAI-${claim.id}-${claim.payout_attempts}`,
      senderItemId: claim.id,
      receiver: startup.paypal_email,
      amount: claim.amount,
      currency: claim.currency ?? "USD",
      note: `Reimbursement: ${claim.vendor ?? "expense"}${claim.receipt_date ? ` (${claim.receipt_date})` : ""}`,
    });
    await query("UPDATE claims SET payout_provider = $2, payout_batch_id = $3, payout_status = $4, updated_at = now() WHERE id = $1", [
      claim.id,
      payout.provider,
      payout.batchId,
      payout.batchStatus,
    ]);
    await recordRun(
      claim,
      "payment",
      "pass",
      `Sent ${formatMoney(claim.amount, claim.currency)} to ${startup.paypal_email} via ${payout.provider === "paypal" ? "PayPal Payouts" : "simulated PayPal"}`,
      { ...payout, receiver: startup.paypal_email, amount: claim.amount, currency: claim.currency, initiatedBy },
      [],
      performance.now() - started,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query("UPDATE claims SET status = 'PAYMENT_FAILED', payout_status = 'ERROR', updated_at = now() WHERE id = $1", [claim.id]);
    await recordRun(claim, "payment", "fail", `Payout failed: ${message}`, { error: message, initiatedBy }, [], performance.now() - started);
    await notify({
      tenantId: claim.tenant_id,
      startupId: claim.startup_id,
      claimId: claim.id,
      message: `Payment for your ${claim.vendor ?? "expense"} claim could not be sent. Finance has been alerted.`,
    });
    return;
  }

  await reconcilePayment(claim.id);
}
