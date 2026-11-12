"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth";
import { json, query, queryOne } from "@/lib/db";
import { policySchema } from "@/lib/policy";
import { UUID_RE } from "@/lib/queries";

export type SettingsState = { error?: string; message?: string };

export async function savePolicy(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await authorize(["admin"]);
  const raw = String(formData.get("policy") ?? "");
  if (raw.length > 20_000) return { error: "The policy is too large." };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "The policy must be valid JSON." };
  }
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
        .join(" · "),
    };
  }

  await query("UPDATE tenants SET policy = $2::jsonb WHERE id = $1", [user.tenantId, json(parsed.data)]);
  await audit({ tenantId: user.tenantId, actor: `user:${user.email}`, action: "policy.updated" });
  refresh();
  return { message: "Policy saved. New claims and re-checks use it immediately." };
}

const startupSchema = z.object({
  id: z.string().regex(UUID_RE),
  paypalEmail: z.email().max(200),
  budgetTotal: z.coerce.number().min(0).max(10_000_000),
});

export async function updateStartup(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await authorize(["admin"]);
  const parsed = startupSchema.safeParse({
    id: formData.get("id"),
    paypalEmail: String(formData.get("paypalEmail") ?? "").trim(),
    budgetTotal: formData.get("budgetTotal"),
  });
  if (!parsed.success) return { error: "Enter a valid PayPal email and a budget of 0 or more." };

  const row = await queryOne<{ id: string }>(
    "UPDATE startups SET paypal_email = $3, budget_total = $4 WHERE id = $1 AND tenant_id = $2 RETURNING id",
    [parsed.data.id, user.tenantId, parsed.data.paypalEmail, parsed.data.budgetTotal],
  );
  if (!row) return { error: "Startup not found." };
  await audit({
    tenantId: user.tenantId,
    actor: `user:${user.email}`,
    action: "startup.updated",
    details: { startupId: row.id, paypalEmail: parsed.data.paypalEmail, budgetTotal: parsed.data.budgetTotal },
  });
  refresh();
  return { message: "Saved." };
}
