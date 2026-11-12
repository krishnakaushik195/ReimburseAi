import "server-only";
import { z } from "zod";
import { maxClaimsPerRun } from "./agent-config";
import { recheckClaim } from "./agents/orchestrator";
import { payClaim } from "./agents/payment";
import { reconcilePayment } from "./agents/payment-recon";
import { audit, notify } from "./audit";
import type { SessionUser } from "./auth";
import { query, queryOne } from "./db";
import { formatMoney } from "./format";
import { parsePolicy } from "./policy";
import { EDITABLE_FIELDS, type ClaimRow, type EditableField } from "./types";

export interface DecisionResult {
  updated: string[];
  skipped: { id: string; reason: string }[];
}

async function tenantPolicy(tenantId: string) {
  const row = await queryOne<{ policy: unknown }>("SELECT policy FROM tenants WHERE id = $1", [tenantId]);
  if (!row) throw new Error("Tenant not found");
  return parsePolicy(row.policy);
}

/** Human-in-the-loop decision on claims waiting in review. Returns the ids that were approved/rejected. */
export async function decideClaims(
  user: SessionUser,
  ids: string[],
  decision: "approve" | "reject",
  note: string,
): Promise<DecisionResult> {
  const policy = await tenantPolicy(user.tenantId);
  const result: DecisionResult = { updated: [], skipped: [] };

  for (const id of ids) {
    const claim = await queryOne<ClaimRow>("SELECT * FROM claims WHERE id = $1 AND tenant_id = $2", [id, user.tenantId]);
    if (!claim) {
      result.skipped.push({ id, reason: "Claim not found" });
      continue;
    }
    if (claim.status !== "IN_REVIEW") {
      result.skipped.push({ id, reason: "Only claims in review can be decided" });
      continue;
    }
    if (claim.submitted_by === user.id) {
      result.skipped.push({ id, reason: "You cannot decide your own claim" });
      continue;
    }
    if (decision === "approve") {
      if (claim.amount === null || claim.amount <= 0) {
        result.skipped.push({ id, reason: "Set a valid amount before approving" });
        continue;
      }
      if (claim.amount > policy.adminApprovalAbove && user.role !== "admin") {
        result.skipped.push({ id, reason: `Claims above ${formatMoney(policy.adminApprovalAbove, policy.currency)} need an admin` });
        continue;
      }
    }

    const status = decision === "approve" ? "APPROVED" : "REJECTED";
    const updated = await queryOne<{ id: string }>(
      `UPDATE claims SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, review_required = false, updated_at = now()
        WHERE id = $1 AND status = 'IN_REVIEW' RETURNING id`,
      [id, status, user.id, note || null],
    );
    if (!updated) {
      result.skipped.push({ id, reason: "Claim changed in the meantime" });
      continue;
    }
    await audit({
      tenantId: user.tenantId,
      claimId: id,
      actor: `user:${user.email}`,
      action: decision === "approve" ? "claim.approved" : "claim.rejected",
      details: { note: note || null, riskScore: claim.risk_score },
    });
    const what = `${claim.vendor ?? "expense"} claim for ${formatMoney(claim.amount, claim.currency)}`;
    await notify({
      tenantId: user.tenantId,
      startupId: claim.startup_id,
      claimId: id,
      message:
        decision === "approve"
          ? `Your ${what} was approved by ${user.name}. Payment is on its way.`
          : `Your ${what} was rejected by ${user.name}${note ? `: ${note}` : "."}`,
    });
    result.updated.push(id);
  }
  return result;
}

export async function payApprovedClaims(ids: string[], user: SessionUser): Promise<void> {
  for (const id of ids) await payClaim(id, `user:${user.email}`);
}

const fieldValue: Record<EditableField, z.ZodType<string | number>> = {
  vendor: z.string().trim().min(1).max(120),
  receipt_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
  amount: z.coerce
    .number()
    .positive()
    .max(1_000_000)
    .transform((v) => Math.round(v * 100) / 100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  category: z.string().min(1),
};

/** Reviewer correction of one extracted field; re-runs the checks so the score reflects the fix. */
export async function updateClaimField(user: SessionUser, id: string, field: string, raw: unknown): Promise<void> {
  if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) throw new Error("This field cannot be edited");
  const key = field as EditableField;
  const parsed = fieldValue[key].safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid value for ${field}`);
  const value = parsed.data;

  const claim = await queryOne<ClaimRow>("SELECT * FROM claims WHERE id = $1 AND tenant_id = $2", [id, user.tenantId]);
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "IN_REVIEW") throw new Error("Only claims in review can be corrected");
  if (key === "category" && !(String(value) in (await tenantPolicy(user.tenantId)).categories)) {
    throw new Error("Unknown category");
  }

  // `key` is checked against the EDITABLE_FIELDS allow-list above, so it is safe as a column name.
  await query(`UPDATE claims SET ${key} = $2, human_verified = true, updated_at = now() WHERE id = $1 AND status = 'IN_REVIEW'`, [
    id,
    value,
  ]);
  await audit({
    tenantId: user.tenantId,
    claimId: id,
    actor: `user:${user.email}`,
    action: "claim.field_corrected",
    details: { field: key, from: claim[key], to: value },
  });
  await recheckClaim(id);
}

export async function retryPayment(user: SessionUser, id: string): Promise<void> {
  const claim = await queryOne<{ id: string }>(
    `UPDATE claims SET status = 'APPROVED', payout_status = NULL, updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND status = 'PAYMENT_FAILED' RETURNING id`,
    [id, user.tenantId],
  );
  if (!claim) throw new Error("Only failed payments can be retried");
  await audit({ tenantId: user.tenantId, claimId: id, actor: `user:${user.email}`, action: "payment.retry_requested" });
}

/** Asks PayPal for the latest status of the tenant's in-flight payouts, oldest first. */
export async function syncPayments(user: SessionUser): Promise<{ checked: number; paid: number; failed: number }> {
  const inFlight = await query<{ id: string }>(
    "SELECT id FROM claims WHERE tenant_id = $1 AND status = 'PAYING' ORDER BY updated_at LIMIT $2",
    [user.tenantId, maxClaimsPerRun()],
  );
  let paid = 0;
  let failed = 0;
  for (const { id } of inFlight) {
    const status = await reconcilePayment(id);
    if (status === "PAID") paid++;
    if (status === "PAYMENT_FAILED") failed++;
  }
  await audit({ tenantId: user.tenantId, actor: `user:${user.email}`, action: "payments.synced", details: { checked: inFlight.length, paid, failed } });
  return { checked: inFlight.length, paid, failed };
}
