/** Runtime switches read from AGENT_* environment variables. */

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Master switch for LLM calls; when false the agents run on OCR + rules even if keys are set. */
export function llmEnabled(): boolean {
  return flag("AGENT_LLM_ENABLED", true);
}

/** When true, payouts are simulated even if PayPal credentials are configured. */
export function dryRun(): boolean {
  return flag("AGENT_DRY_RUN", false);
}

/** Maximum pages read from one uploaded document. */
export function maxPagesPerDocument(): number {
  return integer("AGENT_MAX_PAGES_PER_SOURCE", 20, 1, 200);
}

/** Maximum claims handled by one bulk review action or payout sync (AGENT_MAX_DATASETS_PER_RUN). */
export function maxClaimsPerRun(): number {
  return integer("AGENT_MAX_DATASETS_PER_RUN", 100, 1, 1000);
}
