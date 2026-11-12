"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { maxClaimsPerRun } from "@/lib/agent-config";
import { processClaim } from "@/lib/agents/orchestrator";
import { payClaim } from "@/lib/agents/payment";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth";
import { query } from "@/lib/db";
import { UUID_RE } from "@/lib/queries";
import { decideClaims, payApprovedClaims, retryPayment, syncPayments, updateClaimField } from "@/lib/review";
import { MAX_UPLOAD_BYTES, safeFileName, saveUpload, sha256, sniffMime } from "@/lib/storage";

export type FormState = { error?: string; message?: string };

export async function submitClaim(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await authorize(["claimant"]);
  if (!user.startupId) return { error: "Your account is not linked to a startup." };

  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a receipt or invoice to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "The file is larger than 10 MB." };

  const purpose = String(formData.get("purpose") ?? "")
    .trim()
    .slice(0, 500);
  if (purpose.length < 3) return { error: "Describe the business purpose of this expense." };

  const declaredRaw = String(formData.get("declaredAmount") ?? "").trim();
  let declaredAmount: number | null = null;
  if (declaredRaw) {
    const value = Number(declaredRaw);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return { error: "Enter a valid amount or leave it empty." };
    declaredAmount = Math.round(value * 100) / 100;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buffer);
  if (!mime) return { error: "Upload a PDF, PNG, JPG, WEBP or plain-text receipt." };

  const claimId = randomUUID();
  await saveUpload(user.tenantId, claimId, mime, buffer);
  await query(
    `INSERT INTO claims (id, tenant_id, startup_id, submitted_by, status, purpose, declared_amount, file_name, file_mime, file_sha256, file_size)
     VALUES ($1, $2, $3, $4, 'SUBMITTED', $5, $6, $7, $8, $9, $10)`,
    [claimId, user.tenantId, user.startupId, user.id, purpose, declaredAmount, safeFileName(file.name), mime, sha256(buffer), buffer.length],
  );
  await audit({
    tenantId: user.tenantId,
    claimId,
    actor: `user:${user.email}`,
    action: "claim.submitted",
    details: { file: safeFileName(file.name), mime, bytes: buffer.length },
  });

  // The agent pipeline runs after the response is sent; the claim page polls for progress.
  after(async () => {
    try {
      await processClaim(claimId);
    } catch (error) {
      console.error(`[pipeline] claim ${claimId} crashed`, error);
    }
  });
  redirect(`/claims/${claimId}`);
}

const noteSchema = z.string().trim().max(500);

export type DecisionState = { error?: string; updated?: number; skipped?: { id: string; reason: string }[] };

async function decide(ids: string[], note: string, decision: "approve" | "reject"): Promise<DecisionState> {
  const user = await authorize(["reviewer", "admin"]);
  const limit = maxClaimsPerRun();
  const parsedIds = z
    .array(z.string().regex(UUID_RE))
    .min(1, "Select at least one claim")
    .max(limit, `Select at most ${limit} claims at a time`)
    .safeParse(ids);
  const parsedNote = noteSchema.safeParse(note);
  if (!parsedIds.success) return { error: parsedIds.error.issues[0]?.message ?? "Invalid selection" };
  if (!parsedNote.success) return { error: "The note is too long." };
  if (decision === "reject" && parsedNote.data.length < 3) return { error: "Give a reason for the rejection." };

  const result = await decideClaims(user, parsedIds.data, decision, parsedNote.data);
  if (decision === "approve" && result.updated.length) {
    after(async () => {
      try {
        await payApprovedClaims(result.updated, user);
      } catch (error) {
        console.error("[payment] batch failed", error);
      }
    });
  }
  refresh();
  return { updated: result.updated.length, skipped: result.skipped };
}

export async function approveClaims(ids: string[], note = ""): Promise<DecisionState> {
  return decide(ids, note, "approve");
}

export async function rejectClaims(ids: string[], note: string): Promise<DecisionState> {
  return decide(ids, note, "reject");
}

export async function updateClaimFieldAction(id: string, field: string, value: unknown): Promise<{ error?: string }> {
  const user = await authorize(["reviewer", "admin"]);
  if (!UUID_RE.test(id)) return { error: "Invalid claim id." };
  try {
    await updateClaimField(user, id, field, value);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Update failed." };
  }
  refresh();
  return {};
}

export async function retryPaymentAction(id: string): Promise<{ error?: string }> {
  const user = await authorize(["admin"]);
  if (!UUID_RE.test(id)) return { error: "Invalid claim id." };
  try {
    await retryPayment(user, id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Retry failed." };
  }
  after(async () => {
    try {
      await payClaim(id, `user:${user.email}`);
    } catch (error) {
      console.error("[payment] retry failed", error);
    }
  });
  refresh();
  return {};
}

export async function syncPaymentsAction(): Promise<{ message: string }> {
  const user = await authorize(["reviewer", "admin"]);
  const { checked, paid, failed } = await syncPayments(user);
  refresh();
  return {
    message: checked ? `Checked ${checked} payout(s): ${paid} paid, ${failed} failed, ${checked - paid - failed} pending.` : "No payouts in flight.",
  };
}
