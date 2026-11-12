import { after } from "next/server";
import { reconcilePayment } from "@/lib/agents/payment-recon";
import { queryOne } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/paypal";

/**
 * PayPal Payouts webhook. Deliveries are verified with PayPal before use, and the claim status is
 * always re-read from the PayPal API rather than trusted from the payload.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 200_000) return new Response("Payload too large", { status: 413 });

  let event: { event_type?: string; resource?: { payout_batch_id?: string; batch_header?: { payout_batch_id?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!(await verifyWebhookSignature(request.headers, event))) {
    return new Response("Signature verification failed", { status: 400 });
  }

  const batchId = event.resource?.payout_batch_id ?? event.resource?.batch_header?.payout_batch_id;
  if (batchId) {
    const claim = await queryOne<{ id: string }>("SELECT id FROM claims WHERE payout_batch_id = $1", [batchId]);
    if (claim) {
      after(async () => {
        try {
          await reconcilePayment(claim.id);
        } catch (error) {
          console.error("[webhook] reconciliation failed", error);
        }
      });
    }
  }
  return Response.json({ received: true });
}
