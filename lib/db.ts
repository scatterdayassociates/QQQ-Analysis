// Shared MySQL connection pool. Only the T10Y2Y Regime tab uses a
// database — every other tab in this app computes its data on demand from
// Massive/Alpha Vantage/FRED and relies on Next.js's fetch cache instead of
// persistent state. The regime tab needs actual persistence because its
// "episode" table (start/end dates of each regime, with QQQ performance
// over the episode) is derived by walking the *entire* yield history once
// and is too expensive to recompute from scratch on every page load.
//
// This file must only ever be imported from server code, since it reads
// the secret DATABASE_URL.

import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

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
  pool = mysql.createPool({
    uri: connectionString,
    // DATE/DATETIME columns come back as plain "YYYY-MM-DD" strings instead
    // of JS Date objects (which would otherwise be constructed in the
    // server's local timezone and risk off-by-one-day bugs) — every date in
    // lib/yieldRegime.ts is handled as a string, matching this.
    dateStrings: true,
    // Managed MySQL providers (DigitalOcean, PlanetScale, RDS, etc.)
    // require SSL but present certs that Node's default trust store
    // doesn't chain to — this is the standard pragmatic setting for that
    // case. Skipped for local MySQL, which normally has no SSL at all.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

export async function query<T extends RowDataPacket = RowDataPacket>(text: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await getPool().query<T[]>(text, params);
  return rows;
}

/**
 * Runs `fn` against a single dedicated connection inside a transaction,
 * rolling back on any error. Used for the episode-table rebuild
 * (delete-all + re-insert), which needs to be atomic so a concurrent
 * reader never sees an empty episodes table mid-refresh.
 */
export async function withTransaction<T>(fn: (queryFn: <R extends RowDataPacket = RowDataPacket>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const txQuery = async <R extends RowDataPacket = RowDataPacket>(text: string, params?: unknown[]): Promise<R[]> => {
      const [rows] = await connection.query<R[]>(text, params);
      return rows;
    };
    const result = await fn(txQuery);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

let tablesReady: Promise<void> | null = null;

/**
 * Idempotent schema setup for the regime tables — run lazily before the
 * first query each cold start rather than requiring a separate migration
 * step, since this app has no migration framework. The DDL is also
 * documented in README for anyone who prefers to run it manually. Two
 * separate CREATE TABLE calls rather than one multi-statement query,
 * since mysql2 only allows multiple statements per call when
 * `multipleStatements: true` is set on the pool — not worth enabling for
 * the whole pool just for this one-time setup path.
 */
export function ensureRegimeTables(): Promise<void> {
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS yield_regime_daily (
        \`date\` DATE PRIMARY KEY,
        y10 DECIMAL(6,3) NOT NULL,
        y2 DECIMAL(6,3) NOT NULL,
        spread DECIMAL(6,3) NOT NULL,
        d10y DECIMAL(6,3),
        d2y DECIMAL(6,3),
        dspread DECIMAL(6,3),
        regime VARCHAR(64),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS yield_regime_episodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        regime VARCHAR(64) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        duration_trading_days INT NOT NULL,
        spread_change DECIMAL(6,3) NOT NULL,
        qqq_pct_change DECIMAL(8,4),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX yield_regime_episodes_start_date_idx (start_date DESC)
      )
    `);
  })();
  return tablesReady;
}
