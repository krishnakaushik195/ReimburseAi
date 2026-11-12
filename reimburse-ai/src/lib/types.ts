export const ROLES = ["claimant", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const CLAIM_STATUSES = [
  "SUBMITTED",
  "EXTRACTED",
  "VERIFIED",
  "DEDUP_CHECKED",
  "POLICY_CHECKED",
  "RECONCILED",
  "SCORED",
  "AUTO_APPROVED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "PAYING",
  "PAID",
  "PAYMENT_FAILED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Statuses where agents are still working and the UI should keep polling. */
export const ACTIVE_STATUSES: readonly ClaimStatus[] = [
  "SUBMITTED",
  "EXTRACTED",
  "VERIFIED",
  "DEDUP_CHECKED",
  "POLICY_CHECKED",
  "RECONCILED",
  "SCORED",
  "AUTO_APPROVED",
  "APPROVED",
  "PAYING",
];

export const AGENTS = [
  "orchestrator",
  "ingestion",
  "extraction",
  "verification",
  "duplicate",
  "policy",
  "reconciliation",
  "risk",
  "payment",
  "payment_recon",
] as const;
export type AgentName = (typeof AGENTS)[number];

export const AGENT_LABELS: Record<AgentName, string> = {
  orchestrator: "Orchestrator",
  ingestion: "Ingestion",
  extraction: "Extraction",
  verification: "Verification",
  duplicate: "Duplicate detection",
  policy: "Policy validation",
  reconciliation: "Financial reconciliation",
  risk: "Risk scoring",
  payment: "Payment (PayPal)",
  payment_recon: "Payment reconciliation",
};

export type Outcome = "pass" | "flag" | "fail";
export type RiskLevel = "low" | "medium" | "high";

/**
 * quality: data could not be read reliably; integrity: possible fraud or error;
 * policy: breaks tenant rules; financial: budget or bank-feed findings.
 */
export type SignalKind = "quality" | "integrity" | "policy" | "financial";

export interface RiskSignal {
  code: string;
  kind: SignalKind;
  weight: number;
  message: string;
}

export interface AgentResult<T> {
  outcome: Outcome;
  summary: string;
  data: T;
  signals: RiskSignal[];
}

export interface LineItem {
  description: string;
  amount: number | null;
}

export interface ExtractedReceipt {
  vendor: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  currency: string | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  invoiceNumber: string | null;
  category: string;
  lineItems: LineItem[];
  /** 0..1 */
  confidence: number;
}

export interface ClaimRow {
  id: string;
  tenant_id: string;
  startup_id: string;
  submitted_by: string;
  status: ClaimStatus;
  purpose: string;
  declared_amount: number | null;
  file_name: string;
  file_mime: string;
  file_sha256: string;
  file_size: number;
  ocr_text: string | null;
  vendor: string | null;
  receipt_date: string | null;
  amount: number | null;
  currency: string | null;
  category: string | null;
  invoice_number: string | null;
  extracted: ExtractedReceipt | null;
  confidence: number | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  flags: string[];
  review_required: boolean;
  human_verified: boolean;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  matched_transaction_id: string | null;
  payout_provider: string | null;
  payout_batch_id: string | null;
  payout_status: string | null;
  payout_attempts: number;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StartupRow {
  id: string;
  tenant_id: string;
  name: string;
  paypal_email: string;
  budget_total: number;
}

export interface AgentRunRow {
  id: number;
  agent: AgentName;
  outcome: Outcome;
  summary: string;
  data: unknown;
  signals: RiskSignal[];
  duration_ms: number;
  created_at: Date;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: Date;
}

/** Fields a reviewer may correct inline in the review grid. */
export const EDITABLE_FIELDS = ["vendor", "receipt_date", "amount", "currency", "category"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
