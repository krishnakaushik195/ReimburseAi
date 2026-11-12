import { z } from "zod";

const categoryRuleSchema = z.object({
  label: z.string().min(1),
  limit: z.number().positive(),
  keywords: z.array(z.string().min(2)).default([]),
});

export const policySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
    maxClaimAgeDays: z.number().int().positive(),
    autoApproveMaxAmount: z.number().nonnegative(),
    autoApproveMaxRisk: z.number().int().min(0).max(100),
    rejectMinRisk: z.number().int().min(1).max(100),
    adminApprovalAbove: z.number().nonnegative(),
    minPurposeLength: z.number().int().nonnegative(),
    blockedKeywords: z.array(z.string().min(2)),
    categories: z
      .record(z.string().regex(/^[a-z_]+$/, "Category keys must be lowercase"), categoryRuleSchema)
      .refine((c) => "other" in c, "An 'other' category is required"),
  })
  .refine((p) => p.autoApproveMaxRisk < p.rejectMinRisk, {
    message: "autoApproveMaxRisk must be lower than rejectMinRisk",
    path: ["autoApproveMaxRisk"],
  });

export type TenantPolicy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: TenantPolicy = {
  currency: "USD",
  maxClaimAgeDays: 90,
  autoApproveMaxAmount: 500,
  autoApproveMaxRisk: 30,
  rejectMinRisk: 71,
  adminApprovalAbove: 1000,
  minPurposeLength: 10,
  blockedKeywords: ["alcohol", "wine", "beer", "liquor", "cocktail", "casino", "gift card", "tobacco"],
  categories: {
    travel: {
      label: "Travel",
      limit: 500,
      keywords: ["taxi", "cab", "cabs", "uber", "lyft", "airline", "airlines", "flight", "airport", "train", "rail", "parking", "fuel", "toll", "metro"],
    },
    lodging: {
      label: "Lodging",
      limit: 1500,
      keywords: ["hotel", "inn", "lodging", "airbnb", "resort", "suites", "room", "night"],
    },
    meals: {
      label: "Meals",
      limit: 75,
      keywords: ["restaurant", "cafe", "coffee", "bistro", "lunch", "dinner", "breakfast", "food", "pizza", "grill", "kitchen"],
    },
    software: {
      label: "Software & cloud",
      limit: 300,
      keywords: ["software", "subscription", "saas", "cloud", "license", "hosting", "compute", "api", "seats"],
    },
    office: {
      label: "Office supplies",
      limit: 200,
      keywords: ["office", "stationery", "paper", "printer", "supplies", "desk", "staples", "toner"],
    },
    other: { label: "Other", limit: 100, keywords: [] },
  },
};

export function parsePolicy(value: unknown): TenantPolicy {
  return policySchema.parse(value);
}

export function categoryLabel(policy: TenantPolicy, key: string | null | undefined): string {
  if (!key) return "—";
  return policy.categories[key]?.label ?? key;
}
