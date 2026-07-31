// Shared Postgres connection pool. Only the T10Y2Y Regime tab uses a
// database — every other tab in this app computes its data on demand from
// Massive/Alpha Vantage/FRED and relies on Next.js's fetch cache instead of
// persistent state. The regime tab needs actual persistence because its
// "episode" table (start/end dates of each regime, with QQQ performance
// over the episode) is derived by walking the *entire* yield history once
// and is too expensive to recompute from scratch on every page load.
//
// This file must only ever be imported from server code, since it reads
// the secret DATABASE_URL.

import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (locally) or your Vercel project's Environment " +
        "Variables — see README's T10Y2Y Regime setup section for the connection string format and table DDL."
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({
    connectionString,
    // Managed Postgres providers (Vercel Postgres, Neon, Supabase, RDS,
    // etc.) require SSL but present certs that Node's default trust store
    // doesn't chain to — this is the standard pragmatic setting for that
    // case. Skipped for local Postgres, which normally has no SSL at all.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/**
 * Runs `fn` against a single dedicated client inside BEGIN/COMMIT, rolling
 * back on any error. Used for the episode-table rebuild (delete-all +
 * re-insert), which needs to be atomic so a concurrent reader never sees an
 * empty episodes table mid-refresh.
 */
export async function withTransaction<T>(fn: (queryFn: <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    const txQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]> => {
      const res = await client.query<R>(text, params);
      return res.rows;
    };
    const result = await fn(txQuery);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let tablesReady: Promise<void> | null = null;

/**
 * Idempotent schema setup for the regime tables — run lazily before the
 * first query each cold start rather than requiring a separate migration
 * step, since this app has no migration framework. The DDL is also
 * documented in README for anyone who prefers to run it manually.
 */
export function ensureRegimeTables(): Promise<void> {
  if (tablesReady) return tablesReady;
  tablesReady = query(`
    CREATE TABLE IF NOT EXISTS yield_regime_daily (
      date DATE PRIMARY KEY,
      y10 NUMERIC(6,3) NOT NULL,
      y2 NUMERIC(6,3) NOT NULL,
      spread NUMERIC(6,3) NOT NULL,
      d10y NUMERIC(6,3),
      d2y NUMERIC(6,3),
      dspread NUMERIC(6,3),
      regime TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS yield_regime_episodes (
      id SERIAL PRIMARY KEY,
      regime TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      duration_trading_days INTEGER NOT NULL,
      spread_change NUMERIC(6,3) NOT NULL,
      qqq_pct_change NUMERIC(8,4),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS yield_regime_episodes_start_date_idx
      ON yield_regime_episodes (start_date DESC);
  `).then(() => undefined);
  return tablesReady;
}
