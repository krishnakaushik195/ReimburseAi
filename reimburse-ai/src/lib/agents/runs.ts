import "server-only";
import { audit } from "../audit";
import { json, query } from "../db";
import type { AgentName, Outcome, RiskSignal } from "../types";

/** Persists one agent step (for the claim timeline) and mirrors it into the audit log. */
export async function recordRun(
  claim: { id: string; tenant_id: string },
  agent: AgentName,
  outcome: Outcome,
  summary: string,
  data: unknown,
  signals: RiskSignal[],
  durationMs: number,
): Promise<void> {
  await query(
    `INSERT INTO agent_runs (claim_id, agent, outcome, summary, data, signals, duration_ms)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [claim.id, agent, outcome, summary, json(data), json(signals), Math.round(durationMs)],
  );
  await audit({ tenantId: claim.tenant_id, claimId: claim.id, actor: `agent:${agent}`, action: `agent.${outcome}`, details: { summary } });
}
