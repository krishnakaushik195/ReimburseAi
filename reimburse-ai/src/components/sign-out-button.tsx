"use client";

import { logout } from "@/app/actions/auth";

/** Signs out with a full page load so the routes Next keeps alive for this session are discarded too. */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        await logout();
        window.location.replace("/login");
      }}
    >
      <button type="submit" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        Sign out
      </button>
    </form>
  );
}
