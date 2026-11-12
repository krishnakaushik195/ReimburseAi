"use client";

import { useState, useTransition } from "react";
import { approveClaims, rejectClaims, retryPaymentAction, syncPaymentsAction } from "@/app/actions/claims";

type Message = { tone: "ok" | "error"; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
      {message.text}
    </p>
  );
}

export function ReviewActions({ claimId, hint }: { claimId: string; hint?: string }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const decide = (decision: "approve" | "reject") =>
    startTransition(async () => {
      const result = decision === "approve" ? await approveClaims([claimId], note) : await rejectClaims([claimId], note);
      if (result.error) setMessage({ tone: "error", text: result.error });
      else if (result.skipped?.length) setMessage({ tone: "error", text: result.skipped[0].reason });
      else setMessage({ tone: "ok", text: decision === "approve" ? "Approved — payout started." : "Rejected and claimant notified." });
    });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Note for the audit trail</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Required when rejecting"
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </label>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Approve & pay
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("reject")}
          className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      <Feedback message={message} />
    </div>
  );
}

export function PaymentActions({ claimId, status, isAdmin }: { claimId: string; status: string; isAdmin: boolean }) {
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  if (status === "PAYMENT_FAILED" && isAdmin) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await retryPaymentAction(claimId);
              setMessage(result.error ? { tone: "error", text: result.error } : { tone: "ok", text: "Retrying the payout…" });
            })
          }
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Retry payout
        </button>
        <Feedback message={message} />
      </div>
    );
  }
  if (status === "PAYING") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await syncPaymentsAction();
              setMessage({ tone: "ok", text: result.message });
            })
          }
          className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Check PayPal status
        </button>
        <Feedback message={message} />
      </div>
    );
  }
  return null;
}
