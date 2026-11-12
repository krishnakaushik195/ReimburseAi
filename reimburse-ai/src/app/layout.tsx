import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ReimburseAI", template: "%s · ReimburseAI" },
  description: "AI-augmented reimbursement automation for incubators, investors and organizations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
