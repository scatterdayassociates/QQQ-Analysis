// Postgres connection pool for the 0DTE Convexity Scanner. This is a SEPARATE
// database from the app's existing DATABASE_URL (which is MySQL, used only by
// the T10Y2Y Regime tab via lib/db.ts). The 0DTE tables live on the GCP Cloud
// SQL Postgres instance (qqq-analysis-db → database "smart_money"), reached via
// its own connection string:
//
//   ODTE_DATABASE_URL=postgresql://user:password@35.192.68.127:5432/smart_money
//
// This file must only ever be imported from server code, since it reads the
// secret connection string.

import { Pool, types, type QueryResultRow } from "pg";
import { ODTE_SCHEMA_SQL } from "./schema";

// DATE columns come back as plain "YYYY-MM-DD" strings instead of JS Date
// objects (which would otherwise be constructed in the server's local
// timezone and risk off-by-one-day bugs) — the same convention lib/db.ts
// uses for MySQL via dateStrings. 1082 is Postgres's DATE type OID.
types.setTypeParser(1082, (v) => v);

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.ODTE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "ODTE_DATABASE_URL is not set. Add it to .env.local (locally) or your Vercel project's " +
        "Environment Variables. Format: postgresql://user:password@35.192.68.127:5432/smart_money"
    );
  }

  pool = new Pool({
    connectionString,
    // GCP Cloud SQL presents a Google-managed cert that Node's default trust
    // store doesn't chain to; this is the standard pragmatic setting for
    // sslmode=require semantics against managed Postgres.
    ssl: { rejectUnauthorized: false },
    // Serverless: keep the pool tiny so parallel invocations don't exhaust the
    // instance's connection limit (db-f1/1-vCPU tiers allow few connections).
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Runs the idempotent schema DDL. Safe to call repeatedly. */
export async function runOdteMigration(): Promise<void> {
  const startedAt = Date.now();
  await getPool().query(ODTE_SCHEMA_SQL);
  console.error(`[odte] migration ran in ${Date.now() - startedAt}ms (all statements idempotent)`);
}

// --- Tiny KV layer on Postgres (stands in for Vercel KV) --------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await pgQuery<{ value: T }>("SELECT value FROM odte_kv WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await pgQuery(
    `INSERT INTO odte_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
