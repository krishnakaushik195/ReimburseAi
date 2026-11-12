import type { LlmUsage } from "../llm";
import type { TenantPolicy } from "../policy";
import type { AgentResult, ClaimRow, ExtractedReceipt, RiskLevel, RiskSignal, StartupRow } from "../types";

export interface IngestionData {
  method: "pdf-text" | "ocr" | "plain-text" | "none";
  text: string;
  pages: number | null;
  ocrConfidence: number | null;
  pdfProducer: string | null;
  pdfCreator: string | null;
}

export interface ExtractionData {
  receipt: ExtractedReceipt;
  method: "llm" | "heuristic" | "reviewer";
  llmError: string | null;
  llmUsage: LlmUsage | null;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationData {
  checks: VerificationCheck[];
  lowConfidence: boolean;
}

export interface DuplicateMatch {
  claimId: string;
  status: string;
  reason: string;
  score: number;
}

export interface DuplicateData {
  matches: DuplicateMatch[];
}

export interface PolicyViolation {
  rule: string;
  message: string;
  severity: "hard" | "soft";
}

export interface PolicyData {
  violations: PolicyViolation[];
}

export interface ReconciliationData {
  budget: { total: number; committed: number; remaining: number; remainingAfter: number };
  transaction: {
    matched: boolean;
    id?: string;
    description?: string;
    postedOn?: string;
    amount?: number;
    alreadyClaimedBy?: string | null;
  };
}

export interface RiskData {
  score: number;
  level: RiskLevel;
  reasons: RiskSignal[];
  rationale: string;
  rationaleSource: "llm" | "template";
  llmUsage: LlmUsage | null;
}

export interface PipelineResults {
  ingestion: AgentResult<IngestionData>;
  extraction: AgentResult<ExtractionData>;
  verification: AgentResult<VerificationData>;
  duplicate: AgentResult<DuplicateData>;
  policy: AgentResult<PolicyData>;
  reconciliation: AgentResult<ReconciliationData>;
  risk: AgentResult<RiskData>;
}

export interface PipelineContext {
  claim: ClaimRow;
  tenant: { id: string; name: string; policy: TenantPolicy };
  startup: StartupRow;
  file?: { buffer: Buffer; mime: string };
  /** Text read from the document (PDF text layer, OCR or plain text). */
  text: string;
  results: Partial<PipelineResults>;
}

export function receiptOf(ctx: PipelineContext): ExtractedReceipt {
  const receipt = ctx.results.extraction?.data.receipt;
  if (!receipt) throw new Error("Extraction must run before this agent");
  return receipt;
}
