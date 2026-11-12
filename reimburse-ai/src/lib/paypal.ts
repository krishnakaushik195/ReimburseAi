import "server-only";
import { randomUUID } from "node:crypto";
import { dryRun } from "./agent-config";

/**
 * PayPal Payouts client. With PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET set (and AGENT_DRY_RUN off) it calls
 * the real PayPal API (sandbox by default); otherwise it simulates payouts so the full flow can be demoed.
 * In simulation, a receiver email containing "fail" produces a failed payout.
 */

export type PayoutItemStatus =
  | "SUCCESS"
  | "PENDING"
  | "UNCLAIMED"
  | "ONHOLD"
  | "NEW"
  | "FAILED"
  | "RETURNED"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED"
  | "DENIED"
  | "UNKNOWN";

export const FAILED_PAYOUT_STATUSES: PayoutItemStatus[] = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED"];

export interface PayoutRequest {
  senderBatchId: string;
  senderItemId: string;
  receiver: string;
  amount: number;
  currency: string;
  note: string;
}

export interface PayoutResult {
  provider: "paypal" | "simulated";
  batchId: string;
  batchStatus: string;
}

const PAYPAL_BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/** True when payouts really move money (credentials present and dry run off). */
export function paypalLive(): boolean {
  return paypalConfigured() && !dryRun();
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal authentication failed (HTTP ${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function paypalFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PAYPAL_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { name?: string; message?: string };
  if (!res.ok) throw new Error(`PayPal ${pathname} failed (HTTP ${res.status}) ${body.name ?? ""} ${body.message ?? ""}`.trim());
  return body;
}

export async function createPayout(req: PayoutRequest): Promise<PayoutResult> {
  if (!paypalLive()) {
    const outcome = req.receiver.toLowerCase().includes("fail") ? "FAIL" : "OK";
    return { provider: "simulated", batchId: `SIM-${outcome}-${randomUUID()}`, batchStatus: "PENDING" };
  }
  const body = await paypalFetch<{ batch_header: { payout_batch_id: string; batch_status: string } }>("/v1/payments/payouts", {
    method: "POST",
    headers: { "PayPal-Request-Id": req.senderBatchId },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: req.senderBatchId,
        email_subject: "You have a reimbursement payout",
        email_message: req.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: req.amount.toFixed(2), currency: req.currency },
          receiver: req.receiver,
          note: req.note,
          sender_item_id: req.senderItemId,
        },
      ],
    }),
  });
  return { provider: "paypal", batchId: body.batch_header.payout_batch_id, batchStatus: body.batch_header.batch_status };
}

export async function getPayoutStatus(batchId: string): Promise<{ status: PayoutItemStatus; itemId: string | null }> {
  if (batchId.startsWith("SIM-")) {
    return { status: batchId.startsWith("SIM-FAIL-") ? "FAILED" : "SUCCESS", itemId: `${batchId}-1` };
  }
  const body = await paypalFetch<{ items?: { payout_item_id: string; transaction_status?: string }[] }>(
    `/v1/payments/payouts/${encodeURIComponent(batchId)}`,
  );
  const item = body.items?.[0];
  return { status: (item?.transaction_status as PayoutItemStatus) ?? "UNKNOWN", itemId: item?.payout_item_id ?? null };
}

/** Asks PayPal to verify a webhook delivery. Requires PAYPAL_WEBHOOK_ID. */
export async function verifyWebhookSignature(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !paypalConfigured()) return false;
  const body = await paypalFetch<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  return body.verification_status === "SUCCESS";
}
