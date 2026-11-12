"use server";

import { audit } from "@/lib/audit";
import { clearLoginFailures, createSession, destroySession, homePathFor, loginBlocked, recordLoginFailure } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { Role } from "@/lib/types";

export type LoginState = { error?: string; email?: string; redirectTo?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Enter your email and password.", email };
  if (loginBlocked(email)) return { error: "Too many failed attempts. Try again in a few minutes.", email };

  const user = await queryOne<{ id: string; tenant_id: string; role: Role; password_hash: string }>(
    "SELECT id, tenant_id, role, password_hash FROM users WHERE email = $1",
    [email],
  );
  // Hash even for unknown emails so response time does not reveal which accounts exist.
  const valid = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
  if (!user || !valid) {
    recordLoginFailure(email);
    return { error: "Invalid email or password.", email };
  }

  clearLoginFailures(email);
  await createSession(user.id);
  await audit({ tenantId: user.tenant_id, actor: `user:${email}`, action: "auth.login" });
  // The client follows this with a full page load (see LoginForm), not a soft navigation.
  return { redirectTo: homePathFor(user.role) };
}

export async function logout(): Promise<void> {
  await destroySession();
}
