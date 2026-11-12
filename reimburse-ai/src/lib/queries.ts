import "server-only";
import { dryRun, llmEnabled } from "./agent-config";
import type { SessionUser } from "./auth";
import { query, queryOne } from "./db";
import { getLlm } from "./llm";
import { parsePolicy, type TenantPolicy } from "./policy";
import { paypalLive } from "./paypal";
import type { AgentRunRow, AuditRow, ClaimRow, ClaimStatus, RiskLevel } from "./types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaimListRow {
  id: string;
  status: ClaimStatus;
  startup: string;
  submittedBy: string;
  vendor: string | null;
  receiptDate: string | null;
  amount: number | null;
  currency: string | null;
  category: string | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  flags: string[];
  humanVerified: boolean;
  purpose: string;
  createdAt: string;
}

const LIST_COLUMNS = `
  c.id, c.status, s.name AS startup, u.name AS "submittedBy", c.vendor, c.receipt_date AS "receiptDate",
  c.amount, c.currency, c.category, c.risk_score AS "riskScore", c.risk_level AS "riskLevel", c.flags,
  c.human_verified AS "humanVerified", c.purpose,
  to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`;

const LIST_FROM = `FROM claims c JOIN startups s ON s.id = c.startup_id JOIN users u ON u.id = c.submitted_by`;

export function listTenantClaims(tenantId: string): Promise<ClaimListRow[]> {
  return query<ClaimListRow>(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM}
      WHERE c.tenant_id = $1
      ORDER BY (c.status = 'IN_REVIEW') DESC, c.risk_score DESC NULLS LAST, c.created_at DESC
      LIMIT 500`,
    [tenantId],
  );
}

export function listStartupClaims(user: SessionUser): Promise<ClaimListRow[]> {
  return query<ClaimListRow>(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE c.tenant_id = $1 AND c.startup_id = $2 ORDER BY c.created_at DESC LIMIT 200`,
    [user.tenantId, user.startupId],
  );
}

export function listNotifications(user: SessionUser): Promise<{ id: number; claimId: string | null; message: string; createdAt: Date }[]> {
  return query(
    `SELECT id, claim_id AS "claimId", message, created_at AS "createdAt"
       FROM notifications WHERE tenant_id = $1 AND startup_id = $2 ORDER BY id DESC LIMIT 8`,
    [user.tenantId, user.startupId],
  );
}

export interface ClaimDetail {
  claim: ClaimRow;
  startupName: string;
  payeeEmail: string;
  submitterName: string;
  deciderName: string | null;
  runs: AgentRunRow[];
  audit: AuditRow[];
  policy: TenantPolicy;
}

/** Tenant-scoped; claimants can only see their own startup's claims. */
export async function getClaimDetail(user: SessionUser, id: string): Promise<ClaimDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const claim = await queryOne<ClaimRow & { startup_name: string; payee_email: string; submitter_name: string; decider_name: string | null; policy: unknown }>(
    `SELECT c.*, s.name AS startup_name, s.paypal_email AS payee_email, u.name AS submitter_name, d.name AS decider_name, t.policy
       FROM claims c
       JOIN startups s ON s.id = c.startup_id
       JOIN users u ON u.id = c.submitted_by
       JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN users d ON d.id = c.decided_by
      WHERE c.id = $1 AND c.tenant_id = $2`,
    [id, user.tenantId],
  );
  if (!claim) return null;
  if (user.role === "claimant" && claim.startup_id !== user.startupId) return null;

  const [runs, audit] = await Promise.all([
    query<AgentRunRow>(
      "SELECT id, agent, outcome, summary, data, signals, duration_ms, created_at FROM agent_runs WHERE claim_id = $1 ORDER BY id",
      [id],
    ),
    query<AuditRow>("SELECT id, actor, action, details, created_at FROM audit_log WHERE claim_id = $1 ORDER BY id DESC LIMIT 100", [id]),
  ]);

  const { startup_name, payee_email, submitter_name, decider_name, policy, ...row } = claim;
  return {
    claim: row,
    startupName: startup_name,
    payeeEmail: payee_email,
    submitterName: submitter_name,
    deciderName: decider_name,
    runs,
    audit,
    policy: parsePolicy(policy),
  };
}

export async function getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
  const row = await queryOne<{ policy: unknown }>("SELECT policy FROM tenants WHERE id = $1", [tenantId]);
  if (!row) throw new Error("Tenant not found");
  return parsePolicy(row.policy);
}

export interface ReviewStats {
  inReview: number;
  autoApproved: number;
  paidTotal: number;
  rejected: number;
  total: number;
}

export async function getReviewStats(tenantId: string): Promise<ReviewStats> {
  const row = await queryOne<ReviewStats>(
    `SELECT count(*) FILTER (WHERE status = 'IN_REVIEW')::int AS "inReview",
            count(*) FILTER (WHERE decided_by IS NULL AND status IN ('AUTO_APPROVED', 'PAYING', 'PAID', 'PAYMENT_FAILED'))::int AS "autoApproved",
            COALESCE(sum(amount) FILTER (WHERE status = 'PAID'), 0)::float8 AS "paidTotal",
            count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
            count(*)::int AS total
       FROM claims WHERE tenant_id = $1`,
    [tenantId],
  );
  return row ?? { inReview: 0, autoApproved: 0, paidTotal: 0, rejected: 0, total: 0 };
}

export interface StartupSettingsRow {
  id: string;
  name: string;
  paypalEmail: string;
  budgetTotal: number;
  committed: number;
  paid: number;
}

export function listStartups(tenantId: string): Promise<StartupSettingsRow[]> {
  return query<StartupSettingsRow>(
    `SELECT s.id, s.name, s.paypal_email AS "paypalEmail", s.budget_total AS "budgetTotal",
            COALESCE(sum(c.amount) FILTER (WHERE c.status IN ('AUTO_APPROVED', 'APPROVED', 'PAYING', 'PAID')), 0)::float8 AS committed,
            COALESCE(sum(c.amount) FILTER (WHERE c.status = 'PAID'), 0)::float8 AS paid
       FROM startups s LEFT JOIN claims c ON c.startup_id = s.id
      WHERE s.tenant_id = $1
      GROUP BY s.id
      ORDER BY s.name`,
    [tenantId],
  );
}

export function integrationStatus() {
  const llm = getLlm();
  return {
    llm: llm ? `${llm.provider === "azure" ? "Azure OpenAI" : "OpenAI"} (${llm.label})` : null,
    llmDisabled: !llmEnabled(),
    paypal: paypalLive() ? (process.env.PAYPAL_ENV === "live" ? "PayPal live" : "PayPal sandbox") : null,
    dryRun: dryRun(),
    webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  };
}
