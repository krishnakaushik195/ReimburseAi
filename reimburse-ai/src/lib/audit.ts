import "server-only";
import type { Transaction } from "@electric-sql/pglite";
import { json, query } from "./db";

export async function audit(
  entry: { tenantId: string; claimId?: string | null; actor: string; action: string; details?: Record<string, unknown> },
  tx?: Transaction,
): Promise<void> {
  await query(
    "INSERT INTO audit_log (tenant_id, claim_id, actor, action, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [entry.tenantId, entry.claimId ?? null, entry.actor, entry.action, json(entry.details ?? {})],
    tx,
  );
}

export async function notify(
  entry: { tenantId: string; startupId: string; claimId: string; message: string },
  tx?: Transaction,
): Promise<void> {
  await query(
    "INSERT INTO notifications (tenant_id, startup_id, claim_id, message) VALUES ($1, $2, $3, $4)",
    [entry.tenantId, entry.startupId, entry.claimId, entry.message],
    tx,
  );
}
