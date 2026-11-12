export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${normalizeText(value)} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Trigram Jaccard similarity in [0, 1], similar to Postgres pg_trgm. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Ways an amount can appear on a receipt, used to check extracted values against the source text. */
export function amountVariants(amount: number): string[] {
  const fixed = amount.toFixed(2);
  const grouped = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const variants = new Set([fixed, grouped, fixed.replace(".", ",")]);
  if (Number.isInteger(amount)) variants.add(String(amount));
  return [...variants];
}

export function textContainsAmount(text: string, amount: number): boolean {
  const compact = text.replace(/\s+/g, "");
  return amountVariants(amount).some((v) => compact.includes(v));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsWord(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(word.toLowerCase())}([^a-z0-9]|$)`).test(haystack.toLowerCase());
}

export function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Math.round(ms / 86_400_000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
