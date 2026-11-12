import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { DEMO_ACCOUNTS } from "./demo-accounts";
import { hashPassword } from "./password";
import { DATA_DIR } from "./paths";
import { DEFAULT_POLICY, type TenantPolicy } from "./policy";

const HELIX_POLICY: TenantPolicy = {
  ...DEFAULT_POLICY,
  maxClaimAgeDays: 60,
  autoApproveMaxAmount: 200,
  adminApprovalAbove: 500,
  categories: {
    ...DEFAULT_POLICY.categories,
    meals: { ...DEFAULT_POLICY.categories.meals, limit: 40 },
    lab_supplies: {
      label: "Lab supplies",
      limit: 800,
      keywords: ["reagent", "reagents", "lab", "pipette", "assay", "kit", "gloves"],
    },
  },
};

async function insertId(tx: Transaction, sql: string, params: unknown[]): Promise<string> {
  const res = await tx.query<{ id: string }>(sql, params);
  return res.rows[0].id;
}

/** Creates two demo tenants (an incubator and a hospital lab) on first start. */
export async function seedDemoData(pg: PGlite): Promise<void> {
  const existing = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM tenants");
  if (existing.rows[0].count > 0) return;

  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");

  await pg.transaction(async (tx) => {
    const tenants: Record<string, string> = {
      northstar: await insertId(tx, "INSERT INTO tenants (slug, name, policy) VALUES ($1, $2, $3::jsonb) RETURNING id", [
        "northstar",
        "Northstar Ventures",
        JSON.stringify(DEFAULT_POLICY),
      ]),
      helix: await insertId(tx, "INSERT INTO tenants (slug, name, policy) VALUES ($1, $2, $3::jsonb) RETURNING id", [
        "helix",
        "Helix Health Labs",
        JSON.stringify(HELIX_POLICY),
      ]),
    };

    const startup = (tenant: string, name: string, email: string, budget: number) =>
      insertId(tx, "INSERT INTO startups (tenant_id, name, paypal_email, budget_total) VALUES ($1, $2, $3, $4) RETURNING id", [
        tenants[tenant],
        name,
        email,
        budget,
      ]);
    const startups: Record<string, string> = {
      "Acme Robotics": await startup("northstar", "Acme Robotics", "acme-payouts@example.com", 5000),
      "Lumen Bio": await startup("northstar", "Lumen Bio", "lumen-payouts@example.com", 3000),
      "Cardio Research Unit": await startup("helix", "Cardio Research Unit", "cardio-payouts@example.com", 2000),
    };

    for (const account of DEMO_ACCOUNTS) {
      await tx.query(
        "INSERT INTO users (tenant_id, startup_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          tenants[account.tenant],
          account.startup ? startups[account.startup] : null,
          account.email,
          account.name,
          account.role,
          await hashPassword(password),
        ],
      );
    }

    // Simulated bank / card feed used by the reconciliation agent.
    const feed: [string, string, string, number][] = [
      ["Acme Robotics", "2026-11-03", "CITY CABS NYC 0412", 45.0],
      ["Acme Robotics", "2026-11-01", "CLOUDSTACK INC SUBSCRIPTION", 268.92],
      ["Acme Robotics", "2026-11-05", "LE PETIT BISTRO NEW YORK", 142.5],
      ["Acme Robotics", "2026-10-28", "GRAND HARBOR HOTEL BOSTON", 1240.0],
      ["Acme Robotics", "2026-11-06", "STAPLES #1123", 86.4],
      ["Lumen Bio", "2026-11-02", "UNITED AIRLINES 0162", 412.3],
      ["Cardio Research Unit", "2026-11-04", "LABSOURCE REAGENTS", 389.0],
    ];
    for (const [name, postedOn, description, amount] of feed) {
      const startupId = startups[name];
      const tenantId = name === "Cardio Research Unit" ? tenants.helix : tenants.northstar;
      await tx.query(
        "INSERT INTO bank_transactions (tenant_id, startup_id, posted_on, description, amount, currency) VALUES ($1, $2, $3, $4, $5, 'USD')",
        [tenantId, startupId, postedOn, description, amount],
      );
    }
  });

  const file = path.join(DATA_DIR, "demo-credentials.txt");
  const lines = [
    "ReimburseAI demo accounts (all share one password)",
    `Password: ${password}`,
    "",
    ...DEMO_ACCOUNTS.map((a) => `${a.email.padEnd(26)} ${a.role.padEnd(9)} ${a.startup ?? a.tenant}`),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(
    `[seed] Demo tenants created. ${process.env.DEMO_PASSWORD ? "Password from DEMO_PASSWORD." : `Login details: ${file}`}`,
  );
}
