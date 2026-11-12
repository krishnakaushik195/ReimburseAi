"use client";

import { useActionState } from "react";
import { savePolicy, updateStartup, type SettingsState } from "@/app/actions/settings";
import { SubmitButton } from "@/components/submit-button";

function Result({ state }: { state: SettingsState }) {
  if (state.error) return <p className="text-sm text-rose-700">{state.error}</p>;
  if (state.message) return <p className="text-sm text-emerald-700">{state.message}</p>;
  return null;
}

export function PolicyForm({ initial }: { initial: string }) {
  const [state, action] = useActionState<SettingsState, FormData>(savePolicy, {});
  return (
    <form action={action} className="space-y-3">
      <textarea
        name="policy"
        defaultValue={initial}
        rows={28}
        spellCheck={false}
        className="block w-full rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <div className="flex items-center justify-between gap-4">
        <Result state={state} />
        <SubmitButton pendingText="Validating…">Save policy</SubmitButton>
      </div>
    </form>
  );
}

export function StartupForm({ id, paypalEmail, budgetTotal }: { id: string; paypalEmail: string; budgetTotal: number }) {
  const [state, action] = useActionState<SettingsState, FormData>(updateStartup, {});
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-5 gap-2">
        <label className="col-span-3 block">
          <span className="text-xs text-slate-500">PayPal payout email</span>
          <input
            name="paypalEmail"
            type="email"
            required
            defaultValue={paypalEmail}
            className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="col-span-2 block">
          <span className="text-xs text-slate-500">Grant budget</span>
          <input
            name="budgetTotal"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={budgetTotal}
            className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Result state={state} />
        <SubmitButton className="px-3 py-1 text-xs">Save</SubmitButton>
      </div>
    </form>
  );
}
