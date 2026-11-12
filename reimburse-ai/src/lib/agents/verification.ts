import "server-only";
import { formatMoney } from "../format";
import { normalizeText, textContainsAmount, todayIso } from "../text";
import type { AgentResult, RiskSignal } from "../types";
import { receiptOf, type PipelineContext, type VerificationCheck, type VerificationData } from "./context";

const EDITING_TOOLS = /photoshop|gimp|canva|illustrator|inkscape|pdfescape|sejda|ilovepdf|smallpdf|pdf\s*editor|pdffiller|docfly/i;
const VOID_MARKERS = /\b(void|specimen|sample receipt|duplicate copy|not a valid receipt|training mode)\b/i;
const EXTRA_CHARGES = /\b(tip|gratuity|service charge|surcharge|fee|tolls?)\b/i;

/** Agent 3 — checks that the extracted data is complete, consistent and grounded in the document. */
export async function runVerification(ctx: PipelineContext): Promise<AgentResult<VerificationData>> {
  const receipt = receiptOf(ctx);
  const ingestion = ctx.results.ingestion?.data;
  const text = ctx.text;
  // Reviewer-corrected values may legitimately differ from the document (e.g. a partial claim).
  const reviewerValues = ctx.results.extraction?.data.method === "reviewer";
  const checks: VerificationCheck[] = [];
  const signals: RiskSignal[] = [];
  const check = (name: string, ok: boolean, detail: string, signal: Omit<RiskSignal, "message"> & { message?: string }) => {
    checks.push({ name, ok, detail });
    if (!ok) signals.push({ ...signal, message: signal.message ?? detail });
  };

  const missing = [!receipt.vendor && "vendor", !receipt.date && "date", receipt.total === null && "total"].filter(
    (field): field is string => Boolean(field),
  );
  check(
    "Required fields present",
    missing.length === 0,
    missing.length ? `Could not read: ${missing.join(", ")}` : "Vendor, date and total found",
    { code: "missing_fields", kind: "quality", weight: 10 + 5 * missing.length },
  );

  if (!reviewerValues && receipt.total !== null && receipt.subtotal !== null && receipt.tax !== null) {
    const expected = receipt.subtotal + receipt.tax;
    const exact = Math.abs(expected - receipt.total) <= 0.02;
    const withExtras = receipt.total > expected && EXTRA_CHARGES.test(text);
    check(
      "Totals add up",
      exact || withExtras,
      exact
        ? `Subtotal + tax = ${formatMoney(receipt.total, receipt.currency)}`
        : withExtras
          ? "Total includes tips or fees on top of subtotal + tax"
          : `Subtotal + tax = ${formatMoney(expected, receipt.currency)} but total is ${formatMoney(receipt.total, receipt.currency)}`,
      { code: "math_mismatch", kind: "integrity", weight: 15 },
    );
  }

  if (receipt.date) {
    const future = receipt.date > todayIso();
    const ancient = receipt.date < "2015-01-01";
    check(
      "Date is plausible",
      !future && !ancient,
      future ? `Receipt is dated in the future (${receipt.date})` : ancient ? `Receipt date ${receipt.date} looks wrong` : `Dated ${receipt.date}`,
      future ? { code: "future_date", kind: "integrity", weight: 20 } : { code: "implausible_date", kind: "quality", weight: 10 },
    );
  }

  if (receipt.total !== null) {
    check(
      "Amount is plausible",
      receipt.total > 0 && receipt.total < 100_000,
      `Total is ${formatMoney(receipt.total, receipt.currency)}`,
      { code: "implausible_amount", kind: "integrity", weight: 15 },
    );
  }

  if (reviewerValues) {
    checks.push({ name: "Values found in document", ok: true, detail: "Values confirmed or corrected by a reviewer" });
  } else if (receipt.total !== null && text.trim().length >= 20) {
    const amountFound = textContainsAmount(text, receipt.total);
    const vendorToken = (receipt.vendor ?? "").split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? "";
    const vendorFound = !receipt.vendor || normalizeText(text).includes(normalizeText(vendorToken));
    // Exact text (PDF / plain text) that does not contain the value points to a misread or manipulated extraction.
    const kind = ingestion?.method === "ocr" ? "quality" : "integrity";
    check(
      "Values found in document",
      amountFound && vendorFound,
      amountFound && vendorFound
        ? "Total and vendor appear in the document text"
        : `${amountFound ? "" : "Total"}${!amountFound && !vendorFound ? " and " : ""}${vendorFound ? "" : "vendor"} not found in the document text`,
      { code: "ungrounded_values", kind, weight: 20 },
    );
  } else if (receipt.total !== null && ctx.results.extraction?.data.method === "llm") {
    check("Values found in document", false, "No text to cross-check the AI-read values against", {
      code: "ungrounded_values",
      kind: "quality",
      weight: 10,
    });
  }

  if (ctx.claim.declared_amount !== null && receipt.total !== null) {
    const tolerance = Math.max(0.01, receipt.total * 0.01);
    check(
      "Matches declared amount",
      Math.abs(ctx.claim.declared_amount - receipt.total) <= tolerance,
      `Claimant declared ${formatMoney(ctx.claim.declared_amount, receipt.currency)}, receipt shows ${formatMoney(receipt.total, receipt.currency)}`,
      { code: "declared_mismatch", kind: "integrity", weight: 15 },
    );
  }

  const tool = [ingestion?.pdfProducer, ingestion?.pdfCreator].find((value) => value && EDITING_TOOLS.test(value));
  const marker = text.match(VOID_MARKERS)?.[0];
  check(
    "No tampering markers",
    !tool && !marker,
    tool ? `PDF was produced with an editing tool (${tool})` : marker ? `Document contains "${marker}"` : "No editing tools or void markers detected",
    { code: "tamper_signal", kind: "integrity", weight: 35 },
  );

  const lowConfidence = receipt.confidence < 0.6 || missing.length > 0;
  const passed = checks.filter((c) => c.ok).length;
  return {
    outcome: passed === checks.length ? "pass" : "flag",
    summary: `${passed}/${checks.length} checks passed${lowConfidence ? " · low confidence, needs a human" : ""}`,
    data: { checks, lowConfidence },
    signals,
  };
}
