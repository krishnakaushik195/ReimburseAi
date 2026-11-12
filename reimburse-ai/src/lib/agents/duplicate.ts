import "server-only";
import { query } from "../db";
import { daysBetween, normalizeText, similarity } from "../text";
import type { AgentResult, RiskSignal } from "../types";
import { receiptOf, type DuplicateData, type DuplicateMatch, type PipelineContext } from "./context";

const DEFINITE = 0.95;

/** Agent 4 — finds the same receipt submitted before (identical file, same invoice, or near-identical content). */
export async function runDuplicateCheck(ctx: PipelineContext): Promise<AgentResult<DuplicateData>> {
  const { claim } = ctx;
  const receipt = receiptOf(ctx);
  const matches: DuplicateMatch[] = [];

  const sameFile = await query<{ id: string; status: string }>(
    "SELECT id, status FROM claims WHERE tenant_id = $1 AND file_sha256 = $2 AND id <> $3",
    [claim.tenant_id, claim.file_sha256, claim.id],
  );
  for (const other of sameFile) {
    const rejected = other.status === "REJECTED";
    matches.push({
      claimId: other.id,
      status: other.status,
      reason: rejected ? "Identical file was submitted before and rejected" : "Identical file was already submitted",
      score: rejected ? 0.9 : 1,
    });
  }

  if (receipt.total !== null) {
    const candidates = await query<{
      id: string;
      status: string;
      vendor: string | null;
      receipt_date: string | null;
      invoice_number: string | null;
      ocr_text: string | null;
    }>(
      `SELECT id, status, vendor, receipt_date, invoice_number, ocr_text
         FROM claims
        WHERE tenant_id = $1 AND id <> $2 AND file_sha256 <> $3 AND status <> 'REJECTED'
          AND amount IS NOT NULL AND abs(amount - $4) <= 0.01
        ORDER BY created_at DESC
        LIMIT 50`,
      [claim.tenant_id, claim.id, claim.file_sha256, receipt.total],
    );
    const text = ctx.text.slice(0, 4000);
    for (const other of candidates) {
      const vendorSimilarity = similarity(receipt.vendor, other.vendor);
      const sameInvoice = Boolean(
        receipt.invoiceNumber && other.invoice_number && normalizeText(receipt.invoiceNumber) === normalizeText(other.invoice_number),
      );
      const dayGap = receipt.date && other.receipt_date ? daysBetween(receipt.date, other.receipt_date) : null;
      const textSimilarity = text && other.ocr_text ? similarity(text, other.ocr_text.slice(0, 4000)) : 0;

      let match: Omit<DuplicateMatch, "claimId" | "status"> | null = null;
      if (sameInvoice && vendorSimilarity >= 0.4) match = { reason: "Same vendor, amount and invoice number", score: 0.98 };
      else if (textSimilarity >= 0.92) match = { reason: "Near-identical receipt text and amount", score: 0.95 };
      else if (vendorSimilarity >= 0.5 && dayGap !== null && dayGap <= 1) match = { reason: "Same vendor, amount and date", score: 0.85 };
      else if (vendorSimilarity >= 0.5 && dayGap !== null && dayGap <= 7) match = { reason: "Same vendor and amount within a week", score: 0.6 };
      if (match) matches.push({ claimId: other.id, status: other.status, ...match });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches[0];
  const signals: RiskSignal[] = [];
  if (top && top.score >= DEFINITE) {
    signals.push({ code: "duplicate", kind: "integrity", weight: 100, message: `Duplicate: ${top.reason.toLowerCase()}` });
  } else if (top) {
    signals.push({
      code: "possible_duplicate",
      kind: "integrity",
      weight: Math.round(top.score * 50),
      message: `Possible duplicate: ${top.reason.toLowerCase()}`,
    });
  }

  return {
    outcome: !top ? "pass" : top.score >= DEFINITE ? "fail" : "flag",
    summary: top ? `${matches.length} potential duplicate(s) — ${top.reason}` : "No duplicates found",
    data: { matches: matches.slice(0, 10) },
    signals,
  };
}
