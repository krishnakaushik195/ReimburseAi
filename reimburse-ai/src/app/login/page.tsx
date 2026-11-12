import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ROLE_LABEL = { claimant: "Startup founder", reviewer: "Finance reviewer", admin: "Admin" } as const;

/** Opens (and on first visit seeds) the database so the demo credentials file exists before anyone signs in. */
async function PrepareDatabase() {
  await connection();
  await getDb();
  return null;
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <Suspense fallback={null}>
        <PrepareDatabase />
      </Suspense>
      <section className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 to-indigo-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-base font-black text-blue-700">R</span>
          <span className="text-xl font-bold">ReimburseAI</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Reimbursements that process themselves.</h1>
          <p className="mt-4 text-blue-100">
            Upload a receipt. AI agents read it, verify it, check for duplicates, apply your policy, reconcile it against the budget and
            bank feed, score the risk — and pay low-risk claims through PayPal. People only review the exceptions.
          </p>
        </div>
        <p className="text-sm text-blue-200">Ingestion → Extraction → Verification → Duplicates → Policy → Reconciliation → Risk → PayPal → Reconciliation</p>
      </section>

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use one of the demo accounts below.</p>
          <LoginForm />
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex items-center justify-between gap-3">
                  <code className="text-slate-800">{account.email}</code>
                  <span className="text-xs text-slate-500">
                    {ROLE_LABEL[account.role]} · {account.startup ?? (account.tenant === "helix" ? "Helix Health Labs" : "Northstar Ventures")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              The shared password is <code>DEMO_PASSWORD</code> from your environment, or the one generated in <code>.data/demo-credentials.txt</code> on first start.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
