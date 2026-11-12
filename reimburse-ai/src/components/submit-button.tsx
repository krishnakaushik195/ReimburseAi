"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText, className = "" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
