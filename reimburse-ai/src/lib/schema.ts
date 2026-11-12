export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS startups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  paypal_email text NOT NULL,
  budget_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  startup_id uuid REFERENCES startups(id),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('claimant', 'reviewer', 'admin')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  startup_id uuid NOT NULL REFERENCES startups(id),
  posted_on date NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  startup_id uuid NOT NULL REFERENCES startups(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL,
  purpose text NOT NULL,
  declared_amount numeric(14,2),
  file_name text NOT NULL,
  file_mime text NOT NULL,
  file_sha256 text NOT NULL,
  file_size integer NOT NULL,
  ocr_text text,
  vendor text,
  receipt_date date,
  amount numeric(14,2),
  currency text,
  category text,
  invoice_number text,
  extracted jsonb,
  confidence real,
  risk_score integer,
  risk_level text,
  flags jsonb NOT NULL DEFAULT '[]',
  review_required boolean NOT NULL DEFAULT false,
  human_verified boolean NOT NULL DEFAULT false,
  decision_note text,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  matched_transaction_id uuid REFERENCES bank_transactions(id),
  payout_provider text,
  payout_batch_id text,
  payout_status text,
  payout_attempts integer NOT NULL DEFAULT 0,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claims_tenant_status_idx ON claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS claims_tenant_hash_idx ON claims (tenant_id, file_sha256);
CREATE INDEX IF NOT EXISTS claims_payout_batch_idx ON claims (payout_batch_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id bigserial PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  agent text NOT NULL,
  outcome text NOT NULL,
  summary text NOT NULL,
  data jsonb,
  signals jsonb NOT NULL DEFAULT '[]',
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_claim_idx ON agent_runs (claim_id, id);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_claim_idx ON audit_log (claim_id, id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_id uuid NOT NULL UNIQUE REFERENCES claims(id),
  startup_id uuid NOT NULL REFERENCES startups(id),
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  provider text NOT NULL,
  reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  startup_id uuid NOT NULL REFERENCES startups(id),
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
