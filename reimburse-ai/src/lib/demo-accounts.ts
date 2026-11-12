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
