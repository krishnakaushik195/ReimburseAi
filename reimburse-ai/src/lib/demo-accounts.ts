import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";
import type { Role } from "./types";

export interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  tenant: "northstar" | "helix";
  startup?: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "founder@acme.test", name: "Alex Kim", role: "claimant", tenant: "northstar", startup: "Acme Robotics" },
  { email: "founder@lumen.test", name: "Lena Ortiz", role: "claimant", tenant: "northstar", startup: "Lumen Bio" },
  { email: "reviewer@northstar.test", name: "Ravi Shah", role: "reviewer", tenant: "northstar" },
  { email: "admin@northstar.test", name: "Nora Patel", role: "admin", tenant: "northstar" },
  { email: "researcher@helix.test", name: "Sam Rivera", role: "claimant", tenant: "helix", startup: "Cardio Research Unit" },
  { email: "admin@helix.test", name: "Hana Lee", role: "admin", tenant: "helix" },
];

/** Shared demo login password: DEMO_PASSWORD env, else the value written on first seed. */
export function getDemoPassword(): string | null {
  const fromEnv = process.env.DEMO_PASSWORD?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = fs.readFileSync(path.join(DATA_DIR, "demo-credentials.txt"), "utf8");
    const match = text.match(/^Password:\s*(.+)$/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
