import "server-only";
import { formatMoney } from "../format";
import { heuristicExtract } from "../heuristics";
import { extractReceiptWithLlm, getLlm, type LlmUsage } from "../llm";
import { categoryLabel, type TenantPolicy } from "../policy";
import { roundMoney } from "../text";
import type { AgentResult, ExtractedReceipt, RiskSignal } from "../types";
import type { ExtractionData, PipelineContext } from "./context";

function money(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : roundMoney(value);
}

function normalizeReceipt(receipt: ExtractedReceipt, policy: TenantPolicy): ExtractedReceipt {
  const currency = receipt.currency?.trim().toUpperCase().slice(0, 3) ?? "";
  const date = receipt.date && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date) && !Number.isNaN(Date.parse(receipt.date)) ? receipt.date : null;
  return {
    vendor: receipt.vendor?.trim().slice(0, 120) || null,
    date,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : policy.currency,
    total: money(receipt.total),
    subtotal: money(receipt.subtotal),
    tax: money(receipt.tax),
    invoiceNumber: receipt.invoiceNumber?.trim().slice(0, 64) || null,
    category: receipt.category in policy.categories ? receipt.category : "other",
    lineItems: receipt.lineItems.slice(0, 50).map((item) => ({ description: item.description.slice(0, 200), amount: money(item.amount) })),
    confidence: Math.max(0, Math.min(1, receipt.confidence)),
  };
}

/** Agent 2 — reads vendor, date, amounts, tax, currency and category from the document. */
export async function runExtraction(ctx: PipelineContext): Promise<AgentResult<ExtractionData>> {
  const policy = ctx.tenant.policy;
  const image = ctx.file?.mime.startsWith("image/") ? { mime: ctx.file.mime, data: ctx.file.buffer } : undefined;
  let receipt: ExtractedReceipt | null = null;
  let method: ExtractionData["method"] = "heuristic";
  let llmError: string | null = null;
  let llmUsage: LlmUsage | null = null;

  if (getLlm() && (ctx.text.trim() || image)) {
    try {
      const result = await extractReceiptWithLlm({ text: ctx.text, image, categories: policy.categories, defaultCurrency: policy.currency });
      receipt = result.receipt;
      llmUsage = result.usage;
      method = "llm";
    } catch (error) {
      llmError = error instanceof Error ? error.message : String(error);
    }
  }
  receipt = normalizeReceipt(receipt ?? heuristicExtract(ctx.text, policy), policy);

  const signals: RiskSignal[] = [];
  const percent = Math.round(receipt.confidence * 100);
  if (receipt.confidence < 0.75) {
    signals.push({
      code: "low_extraction_confidence",
      kind: "quality",
      weight: Math.round((1 - receipt.confidence) * 40),
      message: `Extraction confidence is only ${percent}%`,
    });
  }
  if (llmError) {
    signals.push({ code: "llm_unavailable", kind: "quality", weight: 5, message: "AI extraction failed, rule-based fallback used" });
  }

  return {
    outcome: signals.length ? "flag" : "pass",
    summary: `${receipt.vendor ?? "Unknown vendor"} · ${formatMoney(receipt.total, receipt.currency)} · ${categoryLabel(policy, receipt.category)} — ${
      method === "llm" ? "AI" : "rule-based"
    } extraction, ${percent}% confidence`,
    data: { receipt, method, llmError, llmUsage },
    signals,
  };
}
