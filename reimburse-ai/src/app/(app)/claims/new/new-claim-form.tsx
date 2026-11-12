"use client";

import { useActionState } from "react";
import { submitClaim, type FormState } from "@/app/actions/claims";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";

export function NewClaimForm({ currency }: { currency: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitClaim, {});

  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Receipt or invoice</span>
        <input
          name="receipt"
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
          className="mt-1 block w-full cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:bg-slate-100"
        />
        <span className="mt-1 block text-xs text-slate-500">PDF, PNG, JPG, WEBP or plain text · up to 10 MB</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Business purpose</span>
        <textarea name="purpose" required rows={3} maxLength={500} placeholder="e.g. Taxi from the airport to the investor meeting" className={inputClass} />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">
          Amount you are claiming <span className="font-normal text-slate-400">(optional, {currency})</span>
        </span>
        <input name="declaredAmount" type="number" step="0.01" min="0.01" inputMode="decimal" placeholder="Leave empty to use the receipt total" className={inputClass} />
        <span className="mt-1 block text-xs text-slate-500">The verification agent compares this with the receipt.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Submit for processing"}
      </button>
    </form>
  );
}
