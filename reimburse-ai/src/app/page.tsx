import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, homePathFor } from "@/lib/auth";

export default function Home() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-slate-500">Loading…</p>}>
      <RedirectHome />
    </Suspense>
  );
}

async function RedirectHome(): Promise<null> {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
