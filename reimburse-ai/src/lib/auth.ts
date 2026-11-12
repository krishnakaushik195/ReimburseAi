import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { queryOne } from "./db";
import { DATA_DIR } from "./paths";
import type { Role } from "./types";

const COOKIE_NAME = "rai_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  tenantName: string;
  startupId: string | null;
  startupName: string | null;
}

let cachedSecret: Buffer | null = null;

function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cachedSecret = Buffer.from(fromEnv);
    return cachedSecret;
  }
  // No secret configured: generate a random one once and keep it in .data so sessions survive restarts.
  const file = path.join(DATA_DIR, "session-secret");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 });
  cachedSecret = Buffer.from(fs.readFileSync(file, "utf8").trim());
  return cachedSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function readToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: string; exp?: number };
    if (!data.uid || !data.exp || data.exp * 1000 < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<void> {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  (await cookies()).set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** Data Access Layer entry point: the only place that turns a cookie into a user. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  // Session expiry depends on the current time, so this must run at request time, never in a prerender.
  await connection();
  const userId = readToken(token);
  if (!userId) return null;
  return queryOne<SessionUser>(
    `SELECT u.id, u.email, u.name, u.role,
            u.tenant_id AS "tenantId", t.name AS "tenantName",
            u.startup_id AS "startupId", s.name AS "startupName"
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN startups s ON s.id = u.startup_id
      WHERE u.id = $1`,
    [userId],
  );
});

/** For pages: redirects to /login when signed out, or home when the role is not allowed. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting on a role mismatch. */
export async function authorize(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) throw new Error("You are not allowed to perform this action.");
  return user;
}

export function homePathFor(role: Role): string {
  return role === "claimant" ? "/claims" : "/review";
}

const failedLogins = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

export function loginBlocked(key: string): boolean {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(key: string): void {
  const entry = failedLogins.get(key);
  if (!entry || entry.resetAt < Date.now()) failedLogins.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else entry.count += 1;
}

export function clearLoginFailures(key: string): void {
  failedLogins.delete(key);
}
