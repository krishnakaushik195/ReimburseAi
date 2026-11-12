import "server-only";
import { notify } from "../audit";
import { query, queryOne, transaction } from "../db";
import { formatMoney } from "../format";
import { FAILED_PAYOUT_STATUSES, getPayoutStatus, type PayoutItemStatus } from "../paypal";
import type { ClaimRow, ClaimStatus } from "../types";
import { recordRun } from "./runs";

/**
 * Agent 9 — confirms the payout with PayPal, then marks the claim PAID and writes the ledger entry.
 * Runs right after a payout, from the PayPal webhook, or from "Sync payments".
 */
export async function reconcilePayment(claimId: string): Promise<ClaimStatus | null> {
  const claim = await queryOne<ClaimRow>(
    "SELECT * FROM claims WHERE id = $1 AND status = 'PAYING' AND payout_batch_id IS NOT NULL",
    [claimId],
  );
  if (!claim?.payout_batch_id) return null;
  const started = performance.now();

  let status: PayoutItemStatus;
  try {
    ({ status } = await getPayoutStatus(claim.payout_batch_id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRun(claim, "payment_recon", "flag", `Could not fetch payout status: ${message}`, null, [], performance.now() - started);
    return "PAYING";
  }

  if (status === "SUCCESS") {
    const paid = await transaction(async (tx) => {
      const row = await queryOne<ClaimRow>(
        "UPDATE claims SET status = 'PAID', payout_status = 'SUCCESS', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'PAYING' RETURNING *",
        [claim.id],
        tx,
      );
      if (!row) return null;
      await query(
        `INSERT INTO ledger_entries (tenant_id, claim_id, startup_id, amount, currency, provider, reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (claim_id) DO NOTHING`,
        [row.tenant_id, row.id, row.startup_id, row.amount, row.currency, row.payout_provider, row.payout_batch_id],
        tx,
      );
      await notify(
        {
          tenantId: row.tenant_id,
          startupId: row.startup_id,
          claimId: row.id,
          message: `Paid: ${formatMoney(row.amount, row.currency)} for ${row.vendor ?? "your expense"} was sent to your PayPal account.`,
        },
        tx,
      );
      return row;
    });
    if (paid) {
      await recordRun(paid, "payment_recon", "pass", `PayPal confirmed the payout (${status}); ledger entry written`, { batchId: claim.payout_batch_id, status }, [], performance.now() - started);
    }
    return "PAID";
  }

  if (FAILED_PAYOUT_STATUSES.includes(status)) {
    await query("UPDATE claims SET status = 'PAYMENT_FAILED', payout_status = $2, updated_at = now() WHERE id = $1 AND status = 'PAYING'", [
      claim.id,
      status,
    ]);
    await recordRun(claim, "payment_recon", "fail", `Payout ${status.toLowerCase()} — finance needs to retry or fix the payee`, { batchId: claim.payout_batch_id, status }, [], performance.now() - started);
    await notify({
      tenantId: claim.tenant_id,
      startupId: claim.startup_id,
      claimId: claim.id,
      message: `Payment for your ${claim.vendor ?? "expense"} claim failed (${status}). Finance has been alerted.`,
    });
    return "PAYMENT_FAILED";
  }

  await query("UPDATE claims SET payout_status = $2, updated_at = now() WHERE id = $1", [claim.id, status]);
  await recordRun(claim, "payment_recon", "flag", `Payout is ${status.toLowerCase()}; waiting for PayPal`, { batchId: claim.payout_batch_id, status }, [], performance.now() - started);
  return "PAYING";
}
