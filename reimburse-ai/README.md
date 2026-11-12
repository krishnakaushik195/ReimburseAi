# ReimburseAI — MVP

AI-augmented reimbursement automation. A startup uploads a receipt; a pipeline of agents reads, verifies, de-duplicates, checks policy,
reconciles against budget and bank feed, scores risk, and pays low-risk claims through PayPal. Finance staff only handle the exceptions,
in an AG Grid review queue.

Runs fully offline out of the box (embedded Postgres, local OCR, rule-based extraction, simulated PayPal). Add an OpenAI / Azure OpenAI
key and PayPal sandbox credentials to switch on AI extraction and real payouts.

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first start the app creates its database in `.data/` and seeds two tenants. All demo accounts share one
password: set `DEMO_PASSWORD` in `.env` before the first start, or read the generated one from `.data/demo-credentials.txt`.

| Account | Role | Tenant |
| --- | --- | --- |
| `founder@acme.test` | Claimant (Acme Robotics) | Northstar Ventures |
| `founder@lumen.test` | Claimant (Lumen Bio) | Northstar Ventures |
| `reviewer@northstar.test` | Finance reviewer | Northstar Ventures |
| `admin@northstar.test` | Admin | Northstar Ventures |
| `researcher@helix.test` | Claimant (Cardio Research Unit) | Helix Health Labs |
| `admin@helix.test` | Admin | Helix Health Labs |

To start over, stop the server and delete `.data/`.

## Demo script

Sample receipts are in `samples/` (`npm run samples` regenerates the PDFs and the text receipt).

1. **founder@acme.test** → *Submit a claim*, upload each sample and watch the agents work live:
   | Sample | Expected outcome |
   | --- | --- |
   | `01-city-cabs-taxi.png` | OCR → auto-approved → paid |
   | `02-cloudstack-invoice.pdf` | Auto-approved → paid |
   | `05-staples-order.txt` | Auto-approved → paid |
   | `03-le-petit-bistro.png` | Review: over the meals limit and contains wine |
   | `04-grand-harbor-hotel.pdf` | Review: above the auto-approval limit, needs an admin |
   | `06-brightline-invoice-edited.pdf` | Rejected: PDF produced with Photoshop, over the "Other" limit |
   | `07-city-cabs-taxi-photo.png` or `01` again | Rejected as a duplicate |
2. **reviewer@northstar.test** → *Review queue* (AG Grid). Double-click a cell to correct a value (the agents re-check it), select rows,
   add a note and *Approve & pay*. The hotel is skipped because it needs an admin.
3. **admin@northstar.test** → approve the hotel from its claim page. In *Policy & payees*, edit the JSON policy, or give a payee an email
   containing `fail` to see a failed payout and the *Retry payout* flow.
4. **admin@helix.test** → a separate tenant with its own policy and an empty queue.

## The agentic flow in code

```
Upload → Ingestion → Extraction → Verification → Duplicates → Policy → Reconciliation → Risk → Route
                                                                                      ├─ low risk ──► Payment → Payment reconciliation → PAID
                                                                                      ├─ medium ────► Human review (AG Grid) ─► approve / reject
                                                                                      └─ high / dup ► REJECTED
```

| # | Agent | File | Job |
| --- | --- | --- | --- |
| 0 | Orchestrator | `src/lib/agents/orchestrator.ts` | Runs the agents, moves the claim through its states, routes the result |
| 1 | Ingestion | `src/lib/agents/ingestion.ts` | PDF text layer (unpdf), OCR for images (tesseract.js), plain text |
| 2 | Extraction | `src/lib/agents/extraction.ts` | LLM with a strict JSON schema, or the offline parser in `src/lib/heuristics.ts` |
| 3 | Verification | `src/lib/agents/verification.ts` | Required fields, totals, dates, values grounded in the document, declared amount, tampering markers |
| 4 | Duplicate detection | `src/lib/agents/duplicate.ts` | File hash, invoice number, vendor + amount + date, trigram text similarity |
| 5 | Policy validation | `src/lib/agents/policy-check.ts` | Tenant policy: category limits, claim age, currency, blocked items, business purpose |
| 6 | Reconciliation | `src/lib/agents/reconciliation.ts` | Remaining grant budget, match to the bank / card feed, transaction already claimed |
| 7 | Risk scoring | `src/lib/agents/risk.ts` | Weighted 0–100 score with reasons; the LLM only writes the explanation |
| 8 | Payment | `src/lib/agents/payment.ts` | PayPal Payouts to the startup's registered account |
| 9 | Payment reconciliation | `src/lib/agents/payment-recon.ts` | Confirms the payout, writes the ledger, notifies the claimant |

Routing (orchestrator): duplicates and high risk are rejected; low confidence, policy violations, possible duplicates, medium risk or
amounts above `autoApproveMaxAmount` go to review; everything else is auto-approved and paid. Every agent step and human action is stored
in `agent_runs` and `audit_log` and shown on the claim page.

Claim states: `SUBMITTED → EXTRACTED → VERIFIED → DEDUP_CHECKED → POLICY_CHECKED → RECONCILED → SCORED → AUTO_APPROVED | IN_REVIEW | REJECTED`,
then `APPROVED → PAYING → PAID | PAYMENT_FAILED`.

## Configuration

Settings live in `.env` (template: `.env.example`). All are optional; restart `npm run dev` after changing them.

| Variable | Effect |
| --- | --- |
| `DEMO_PASSWORD` | Password for the seeded accounts (first start only) |
| `SESSION_SECRET` | 32+ character cookie-signing secret; generated into `.data/` if missing |
| `REIMBURSE_DATA_DIR` | Writable directory for PGlite, uploads, and local secrets; defaults to `.data/` locally and `/tmp/reimburse-ai` on Vercel |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | AI extraction and risk explanations via OpenAI |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | Same via Azure OpenAI (takes precedence) |
| `AZURE_OPENAI_MODEL` | Model name shown in the UI for the Azure deployment |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` | Real PayPal Payouts (sandbox by default) |
| `PAYPAL_WEBHOOK_ID` | Accept verified PayPal webhooks at `/api/webhooks/paypal` |
| `AGENT_LLM_ENABLED` | `false` stops all LLM calls without removing keys (default `true`) |
| `AGENT_DRY_RUN` | `true` keeps payouts simulated even with PayPal credentials (default `false`) |
| `AGENT_MAX_PAGES_PER_SOURCE` | Maximum PDF pages read per uploaded document (default 20) |
| `AGENT_MAX_DATASETS_PER_RUN` | Maximum claims per bulk approve/reject or PayPal sync (default 100) |

With PayPal sandbox credentials, set each payee's email (Policy & payees) to a sandbox personal account. Without a public webhook URL,
use *Sync PayPal* in the review queue to pull payout status.

## Security notes

- Signed, httpOnly session cookie; scrypt password hashes; login throttling.
- Every query is scoped to the user's tenant; claimants only see their own startup's claims and files.
- Uploads: type detected from file bytes (PDF, PNG, JPEG, WEBP, text), 10 MB limit, stored outside `public/`, served with `nosniff`.
- LLM output is treated as data: receipts are untrusted input, values are cross-checked against the document, and every decision is rule-based.
- Payouts go only to the payee registered on the startup, a conditional status update prevents double payment, PayPal batch IDs are
  idempotent, and webhooks are signature-verified and re-checked against the PayPal API.
- Segregation of duties: nobody can decide their own claim, and claims above `adminApprovalAbove` need an admin.

## Stack

Next.js 16 (App Router, Server Actions, Cache Components) · React 19 · Tailwind CSS 4 · AG Grid Community 36 · PGlite (embedded
Postgres in `.data/pg`) · tesseract.js · unpdf · OpenAI SDK · Zod · PayPal Payouts REST API.

## Next steps beyond the MVP

Hosted Postgres (the SQL is plain Postgres), object storage for receipts, a job queue for the pipeline, SSO, pgvector embeddings for
semantic duplicate detection, email notifications, and multi-currency conversion.

## Serverless deployments

On Vercel, the app uses `/tmp/reimburse-ai` automatically because the deployed filesystem is read-only. This prevents startup failures,
but the directory is ephemeral and is not shared between serverless instances. Set `DEMO_PASSWORD` and `SESSION_SECRET` in the deployment
environment for a stable demo password and sessions. For production, use persistent Postgres and object storage instead of the embedded
database and local upload directory.
