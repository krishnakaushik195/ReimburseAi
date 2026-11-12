import type { TenantPolicy } from "./policy";
import { containsWord, roundMoney } from "./text";
import type { ExtractedReceipt, LineItem } from "./types";

/**
 * Offline receipt parser used when no LLM is configured (or the LLM call fails).
 * It is deliberately conservative: anything it is unsure about lowers the confidence
 * so the claim is routed to a human instead of being auto-approved.
 */

const AMOUNT = String.raw`(?<![\d.,])(?:[$€£₹]\s?)?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.]|\s?%)`;
const MONTH_NAME = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const TOTAL_LABEL = /\b(grand\s*total|total\s*(due|paid|amount|charged)?|amount\s*(due|paid|charged)|balance\s*due)\b/i;
const TOTAL_EXCLUDE = /\b(sub\s*-?\s*total|total\s*tax|tax\s*total|total\s*items?|items?\s*total|total\s*savings)\b/i;
const SUBTOTAL_LABEL = /\bsub\s*-?\s*total\b/i;
const TAX_LABEL = /\b(sales\s*tax|tax|vat|gst|hst)\b/i;
const TAX_EXCLUDE = /\b(total|incl|including|excl|tax\s*id|vat\s*(no|number|reg))\b/i;
const EMAIL_HEADER = /^(from|to|cc|bcc|subject|sent|date|reply-to)\s*:/i;
const VENDOR_SKIP =
  /\b(receipt|invoice|tax invoice|bill to|billed to|order|date|time|tel|phone|fax|www|http|email|customer|cashier|table|server|thank|welcome|page)\b|@/i;
const ITEM_SKIP =
  /\b(total|subtotal|sub-total|tax|vat|gst|tip|gratuity|change|cash|card|visa|mastercard|amex|balance|paid|due|discount|rounding|tendered|payment)\b/i;

function amountsIn(line: string): number[] {
  return [...line.matchAll(new RegExp(AMOUNT, "g"))].map((m) => Number(m[1].replace(/,/g, "")));
}

function stripAmounts(line: string): string {
  return line.replace(new RegExp(AMOUNT, "g"), "");
}

function findLabeledAmount(lines: string[], label: RegExp, exclude?: RegExp, fromBottom = false): number | null {
  const indexes = lines.map((_, i) => i);
  if (fromBottom) indexes.reverse();
  for (const i of indexes) {
    const line = lines[i];
    if (!label.test(line) || exclude?.test(line)) continue;
    const here = amountsIn(line);
    if (here.length) return here[here.length - 1];
    const next = lines[i + 1];
    if (next && !/[a-z]{3,}/i.test(stripAmounts(next))) {
      const below = amountsIn(next);
      if (below.length) return below[below.length - 1];
    }
  }
  return null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

function monthIndex(word: string): number {
  return MONTH_NAME.test(word) ? MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1 : 0;
}

function parseDateIn(text: string): string | null {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);

  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // Ambiguous dd/mm vs mm/dd: assume US order unless the first part cannot be a month.
    return a > 12 ? isoDate(+m[3], b, a) : isoDate(+m[3], a, b);
  }

  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (m && monthIndex(m[1])) return isoDate(+m[3], monthIndex(m[1]), +m[2]);

  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/);
  if (m && monthIndex(m[2])) return isoDate(+m[3], monthIndex(m[2]), +m[1]);

  return null;
}

function findDate(lines: string[]): string | null {
  const labeled = lines.filter((l) => /\b(date|issued|paid on|invoice date)\b/i.test(l));
  for (const line of [...labeled, ...lines]) {
    const date = parseDateIn(line);
    if (date) return date;
  }
  return null;
}

function findVendor(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    if (EMAIL_HEADER.test(line) || VENDOR_SKIP.test(line)) continue;
    const cleaned = line.replace(/[^\p{L}\p{N}&'.,\- ]/gu, "").replace(/\s{2,}/g, " ").trim();
    if (cleaned.length < 3 || !/[a-z]{3,}/i.test(cleaned) || /^\d/.test(cleaned)) continue;
    return cleaned.replace(/[.,\-\s]+$/, "");
  }
  return null;
}

function findCurrency(text: string): string | null {
  const iso = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|JPY|CHF)\b/);
  if (iso) return iso[1];
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  if (text.includes("₹") || /\bRs\.?\s?\d/.test(text)) return "INR";
  if (text.includes("$")) return "USD";
  return null;
}

function guessCategory(text: string, vendor: string | null, policy: TenantPolicy): string {
  let best = "other";
  let bestScore = 0;
  for (const [key, rule] of Object.entries(policy.categories)) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (vendor && containsWord(vendor, keyword)) score += 3;
      else if (containsWord(text, keyword)) score += 1;
    }
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

function findLineItems(lines: string[]): LineItem[] {
  const items: LineItem[] = [];
  const itemLine = new RegExp(String.raw`^(.*?[A-Za-z].*?)\s+${AMOUNT}$`);
  for (const line of lines) {
    if (ITEM_SKIP.test(line)) continue;
    const m = line.match(itemLine);
    if (m) items.push({ description: m[1].replace(/\s{2,}/g, " ").trim(), amount: Number(m[2].replace(/,/g, "")) });
    if (items.length >= 25) break;
  }
  return items;
}

export function heuristicExtract(text: string, policy: TenantPolicy): ExtractedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const vendor = findVendor(lines);
  const date = findDate(lines);
  const labeledTotal = findLabeledAmount(lines, TOTAL_LABEL, TOTAL_EXCLUDE, true);
  const allAmounts = lines.flatMap(amountsIn);
  const total = labeledTotal ?? (allAmounts.length ? Math.max(...allAmounts) : null);
  const subtotal = findLabeledAmount(lines, SUBTOTAL_LABEL);
  const tax = findLabeledAmount(lines, TAX_LABEL, TAX_EXCLUDE);
  const explicitCurrency = findCurrency(text);
  const invoiceNumber =
    text.match(/\b(?:invoice|receipt|order|bill|ref)\s*(?:no\.?|number|num|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1] ?? null;

  let confidence = 0.15;
  if (vendor) confidence += 0.2;
  if (date) confidence += 0.2;
  if (total !== null) confidence += labeledTotal !== null ? 0.3 : 0.15;
  if (explicitCurrency) confidence += 0.05;
  if (subtotal !== null && tax !== null && total !== null && Math.abs(subtotal + tax - total) <= 0.02) confidence += 0.1;

  return {
    vendor,
    date,
    currency: explicitCurrency ?? policy.currency,
    total: total === null ? null : roundMoney(total),
    subtotal,
    tax,
    invoiceNumber,
    category: guessCategory(text, vendor, policy),
    lineItems: findLineItems(lines),
    confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
  };
}
