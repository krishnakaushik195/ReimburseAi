import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { SignOutButton } from "./sign-out-button";

const NAV: Record<Role, { href: string; label: string }[]> = {
  claimant: [
    { href: "/claims", label: "My claims" },
    { href: "/claims/new", label: "Submit a claim" },
  ],
  reviewer: [{ href: "/review", label: "Review queue" }],
  admin: [
    { href: "/review", label: "Review queue" },
    { href: "/settings", label: "Policy & payees" },
  ],
};

export async function AppHeader() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-6 px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">R</span>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              Reimburse<span className="text-blue-600">AI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV[user.role].map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="text-xs text-slate-500">
              {user.role === "claimant" ? user.startupName : user.role === "admin" ? "Admin" : "Reviewer"} · {user.tenantName}
            </p>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

export function AppHeaderSkeleton() {
  return <div className="h-16 border-b border-slate-200 bg-white" />;
}
