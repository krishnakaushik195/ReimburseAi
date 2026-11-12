import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PGlite, types, type Transaction } from "@electric-sql/pglite";
import { DATA_DIR } from "./paths";
import { SCHEMA } from "./schema";
import { seedDemoData } from "./seed";

/**
 * Embedded Postgres (PGlite) stored under .data/pg. The SQL is plain Postgres,
 * so moving to a hosted Postgres later only means swapping this module.
 */

type Runner = Pick<PGlite, "query"> | Transaction;

const globalForDb = globalThis as unknown as { __reimburseDb?: Promise<PGlite> };

async function open(): Promise<PGlite> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pg = await PGlite.create(path.join(DATA_DIR, "pg"), {
    parsers: {
      [types.NUMERIC]: (value: string) => Number(value),
      [types.DATE]: (value: string) => value,
    },
  });
  await pg.exec(SCHEMA);
  await seedDemoData(pg);
  return pg;
}

export function getDb(): Promise<PGlite> {
  // One instance per server process: PGlite is single-connection and owns the data directory.
  globalForDb.__reimburseDb ??= open().catch((error) => {
    globalForDb.__reimburseDb = undefined;
    throw error;
  });
  return globalForDb.__reimburseDb;
}

export async function query<T>(sql: string, params: unknown[] = [], runner?: Runner): Promise<T[]> {
  const db = runner ?? (await getDb());
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T>(sql: string, params: unknown[] = [], runner?: Runner): Promise<T | null> {
  const rows = await query<T>(sql, params, runner);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return (await getDb()).transaction(fn);
}

/** Serialize a value for a `$n::jsonb` parameter. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}
