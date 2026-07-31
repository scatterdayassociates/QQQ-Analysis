// Server-side data + logic for the "T10Y2Y Regime" tab: classifies the
// current 10Y-2Y Treasury yield-curve regime into one of seven states
// (four canonical steepening/flattening regimes, two "mixed" fallbacks, and
// a neutral range-bound state), and overlays that against QQQ/TQQQ price
// action so regime shifts can be visually cross-referenced against equity
// direction.
//
// Unlike every other tab in this app, this one is backed by Postgres (see
// lib/db.ts) rather than computed fresh on every request — the "episode"
// table (one row per contiguous regime, with its QQQ performance) is
// derived by walking the *entire* yield history, which is too expensive to
// redo on every page load. The database is instead kept fresh lazily: any
// read (ensureFreshRegimeData) checks whether the newest stored trading day
// is current and re-runs the FRED fetch + regime computation + episode
// rebuild if not, so correctness never depends on a working cron job —
// vercel.json's cron is a pre-warming nicety on top, not a requirement.
//
// Data sources:
//   - Treasury yields: FRED's public DGS10/DGS2 series (no API key, same
//     `fredgraph.csv` convention already used by lib/fundamentals.ts for
//     VIXCLS/DTWEXBGS, extended here to also capture the date column since
//     the regime engine needs dated observations, not just a value array).
//   - QQQ/TQQQ price overlay: Massive's Custom Bars, via the existing
//     lib/massive.ts (same MASSIVE_API_KEY, no new credential).
// Both degrade gracefully: a stale/unreachable FRED fetch leaves existing
// DB data in place (the read path still returns whatever was last stored,
// with its own "data as of" date), and a failed QQQ fetch just leaves
// qqqPctChange null for the affected episodes rather than failing the tab.
//
// This file must only ever be imported from server code: it reads the
// secret DATABASE_URL (via lib/db.ts) and equity data through lib/massive.ts
// (secret MASSIVE_API_KEY).

import { getCustomBars } from "./massive";
import { ensureRegimeTables, query, withTransaction } from "./db";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const REGIME_THRESHOLD_BPS = envInt("REGIME_THRESHOLD_BPS", 5);
export const REGIME_LOOKBACK_DAYS = envInt("REGIME_LOOKBACK_DAYS", 10);
export const REGIME_BACKFILL_START = process.env.REGIME_BACKFILL_START?.trim() || "2000-01-01"; // QQQ inception (Mar 1999) + margin, so every episode has QQQ overlay coverage

// The pseudocode's own output labels (Section 2) — "Growth Steepening" and
// "Term Premium Steepening" are the two sub-cases of the summary table's
// "Bull Steepening" / "Bear Steepening", surfaced explicitly per the spec
// since distinguishing *why* the spread is widening is the point of this
// tab. "Range-bound / No Signal" covers |dSpread| <= threshold.
export type RegimeLabel =
  | "Growth Steepening"
  | "Term Premium Steepening"
  | "Steepening (Mixed)"
  | "Bull Flattening"
  | "Bear Flattening"
  | "Flattening (Mixed)"
  | "Range-bound / No Signal";

/**
 * Classification logic, transcribed directly from the spec's pseudocode.
 * `thresholdPct` and the d2Y/d10Y/dSpread inputs are all in percentage
 * points (FRED's native units for DGS10/DGS2), not basis points — callers
 * convert REGIME_THRESHOLD_BPS via `/ 100` before calling this.
 */
export function classifyRegime(d2Y: number, d10Y: number, dSpread: number, thresholdPct: number): RegimeLabel {
  if (dSpread > thresholdPct) {
    if (Math.abs(d2Y) > Math.abs(d10Y) && d2Y < 0) return "Growth Steepening";
    if (d10Y > 0 && Math.abs(d10Y) >= Math.abs(d2Y)) return "Term Premium Steepening";
    return "Steepening (Mixed)";
  }
  if (dSpread < -thresholdPct) {
    if (d10Y < 0 && Math.abs(d10Y) >= Math.abs(d2Y)) return "Bull Flattening";
    if (d2Y > 0 && Math.abs(d2Y) >= Math.abs(d10Y)) return "Bear Flattening";
    return "Flattening (Mixed)";
  }
  return "Range-bound / No Signal";
}

interface FredObservation {
  date: string; // YYYY-MM-DD
  value: number;
}

/**
 * Fetches a FRED series with dates (fredgraph.csv's DATE,VALUE columns) —
 * a dated variant of lib/fundamentals.ts's fetchFredSeries, which only
 * keeps values since its callers never needed dates. FRED marks missing
 * observations (weekends, bond-market holidays, series start gaps) with
 * "." — those rows are dropped rather than forward-filled here; the regime
 * engine only ever sees actual trading-day observations, matching the
 * spec's requirement to exclude filled points from classification. (A line
 * chart naturally bridges the resulting date gaps visually by connecting
 * adjacent real points, so no explicit forward-fill is needed for display
 * either.)
 */
async function fetchFredSeriesWithDates(seriesId: string): Promise<FredObservation[]> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: HTTP ${res.status}`);
  }
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // drop header row

  const obs: FredObservation[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!date || raw === undefined || raw === ".") continue;
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) obs.push({ date, value });
  }
  if (obs.length === 0) {
    throw new Error(`FRED series ${seriesId} returned no usable data.`);
  }
  return obs;
}

interface AlignedObservation {
  date: string;
  y10: number;
  y2: number;
}

// Inner join on date: a day only counts if both legs have a real
// observation, which naturally excludes weekends/holidays without needing
// a separate market-calendar lookup.
function alignObservations(y10: FredObservation[], y2: FredObservation[]): AlignedObservation[] {
  const y2ByDate = new Map(y2.map((o) => [o.date, o.value]));
  return y10
    .filter((o) => y2ByDate.has(o.date))
    .map((o) => ({ date: o.date, y10: o.value, y2: y2ByDate.get(o.date)! }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface DailyRegimeRow {
  date: string;
  y10: number;
  y2: number;
  spread: number;
  d10y: number | null;
  d2y: number | null;
  dspread: number | null;
  regime: RegimeLabel | null; // null only for the first REGIME_LOOKBACK_DAYS rows of the whole series (not enough history for a lookback comparison yet)
}

function computeDailyRegimes(obs: AlignedObservation[], lookbackDays: number, thresholdBps: number): DailyRegimeRow[] {
  const thresholdPct = thresholdBps / 100;
  return obs.map((o, i) => {
    const spread = o.y10 - o.y2;
    if (i < lookbackDays) {
      return { date: o.date, y10: o.y10, y2: o.y2, spread, d10y: null, d2y: null, dspread: null, regime: null };
    }
    const prior = obs[i - lookbackDays];
    const d10y = o.y10 - prior.y10;
    const d2y = o.y2 - prior.y2;
    const dspread = d10y - d2y; // == spread - prior.spread, per the spec's own equivalence note
    return { date: o.date, y10: o.y10, y2: o.y2, spread, d10y, d2y, dspread, regime: classifyRegime(d2y, d10y, dspread, thresholdPct) };
  });
}

export interface RegimeEpisode {
  regime: RegimeLabel;
  startDate: string;
  endDate: string | null; // null = still ongoing as of the latest stored day
  durationTradingDays: number;
  spreadChange: number;
  qqqPctChange: number | null; // filled in by a separate QQQ-price pass; null if QQQ data is unavailable for the episode's dates
}

function buildEpisodes(rows: DailyRegimeRow[]): RegimeEpisode[] {
  const episodes: RegimeEpisode[] = [];
  let bucket: DailyRegimeRow[] = [];

  const flush = (isCurrent: boolean) => {
    if (bucket.length === 0) return;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    episodes.push({
      regime: first.regime as RegimeLabel,
      startDate: first.date,
      endDate: isCurrent ? null : last.date,
      durationTradingDays: bucket.length,
      spreadChange: last.spread - first.spread,
      qqqPctChange: null,
    });
    bucket = [];
  };

  for (const row of rows) {
    if (row.regime === null) continue; // insufficient history — only ever the first lookbackDays rows of the whole series
    if (bucket.length > 0 && bucket[bucket.length - 1].regime !== row.regime) flush(false);
    bucket.push(row);
  }
  flush(true); // the trailing bucket, if any, is the still-open current episode

  return episodes;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Finds the closest available close on or after `from` and on or before
// `to` (QQQ's trading calendar doesn't perfectly match the bond market's —
// e.g. Good Friday is an equity holiday but not always a bond one, and vice
// versa for Columbus Day/Veterans Day) and returns the % change between
// them. Null if either side has no close within a few days' search window.
function pctChangeNear(closesByDate: Map<string, number>, sortedDates: string[], from: string, to: string): number | null {
  const findOnOrAfter = (target: string): number | null => {
    const idx = sortedDates.findIndex((d) => d >= target);
    return idx === -1 ? null : closesByDate.get(sortedDates[idx])!;
  };
  const findOnOrBefore = (target: string): number | null => {
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      if (sortedDates[i] <= target) return closesByDate.get(sortedDates[i])!;
    }
    return null;
  };

  const startClose = findOnOrAfter(from);
  const endClose = findOnOrBefore(to);
  if (startClose === null || endClose === null || startClose === 0) return null;
  return ((endClose - startClose) / startClose) * 100;
}

async function fillQqqPctChange(episodes: RegimeEpisode[]): Promise<RegimeEpisode[]> {
  if (episodes.length === 0) return episodes;
  try {
    const earliest = episodes[0].startDate;
    const todayStr = toDateStr(new Date());
    const bars = await getCustomBars("QQQ", { timespan: "day", from: earliest, to: todayStr });
    if (bars.length === 0) return episodes;

    const closesByDate = new Map(bars.map((b) => [toDateStr(new Date(b.t)), b.c]));
    const sortedDates = [...closesByDate.keys()].sort();

    return episodes.map((ep) => ({
      ...ep,
      qqqPctChange: pctChangeNear(closesByDate, sortedDates, ep.startDate, ep.endDate ?? todayStr),
    }));
  } catch (err) {
    console.error(`[yield-regime] QQQ overlay fetch for episode %change failed: ${err instanceof Error ? err.message : String(err)}`);
    return episodes; // episodes keep their null qqqPctChange rather than failing the whole refresh
  }
}

const DAILY_UPSERT_CHUNK = 500;

async function upsertDailyRows(rows: DailyRegimeRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += DAILY_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + DAILY_UPSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, idx) => {
      const base = idx * 8;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
      params.push(r.date, r.y10, r.y2, r.spread, r.d10y, r.d2y, r.dspread, r.regime);
    });
    await query(
      `INSERT INTO yield_regime_daily (date, y10, y2, spread, d10y, d2y, dspread, regime)
       VALUES ${values.join(",")}
       ON CONFLICT (date) DO UPDATE SET
         y10 = EXCLUDED.y10, y2 = EXCLUDED.y2, spread = EXCLUDED.spread,
         d10y = EXCLUDED.d10y, d2y = EXCLUDED.d2y, dspread = EXCLUDED.dspread, regime = EXCLUDED.regime`,
      params
    );
  }
}

const EPISODE_INSERT_CHUNK = 500;

async function replaceEpisodes(episodes: RegimeEpisode[]): Promise<void> {
  await withTransaction(async (txQuery) => {
    await txQuery("DELETE FROM yield_regime_episodes");
    for (let i = 0; i < episodes.length; i += EPISODE_INSERT_CHUNK) {
      const chunk = episodes.slice(i, i + EPISODE_INSERT_CHUNK);
      if (chunk.length === 0) continue;
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((ep, idx) => {
        const base = idx * 6;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
        params.push(ep.regime, ep.startDate, ep.endDate, ep.durationTradingDays, ep.spreadChange, ep.qqqPctChange);
      });
      await txQuery(
        `INSERT INTO yield_regime_episodes (regime, start_date, end_date, duration_trading_days, spread_change, qqq_pct_change)
         VALUES ${values.join(",")}`,
        params
      );
    }
    return undefined;
  });
}

let refreshInFlight: Promise<{ daysWritten: number; episodesWritten: number }> | null = null;

/**
 * The "daily job" from the spec, reframed as an idempotent function rather
 * than a standalone script: fetch full FRED history, recompute the regime
 * classification and episode table from scratch, and upsert both into
 * Postgres. Recomputing everything (rather than an incremental delta) is
 * deliberately simple — the full DGS10/DGS2-since-2000 history is only a
 * few thousand rows, trivial to reprocess in-memory every time, and this
 * sidesteps an entire class of incremental-update bugs (e.g. a late-arriving
 * FRED revision to a prior day silently going unfixed).
 */
export async function refreshRegimeData(): Promise<{ daysWritten: number; episodesWritten: number }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    await ensureRegimeTables();

    const [y10Obs, y2Obs] = await Promise.all([fetchFredSeriesWithDates("DGS10"), fetchFredSeriesWithDates("DGS2")]);
    const aligned = alignObservations(y10Obs, y2Obs).filter((o) => o.date >= REGIME_BACKFILL_START);
    const dailyRows = computeDailyRegimes(aligned, REGIME_LOOKBACK_DAYS, REGIME_THRESHOLD_BPS);

    await upsertDailyRows(dailyRows);

    const episodesRaw = buildEpisodes(dailyRows);
    const episodes = await fillQqqPctChange(episodesRaw);
    await replaceEpisodes(episodes);

    console.error(`[yield-regime] refreshed: ${dailyRows.length} daily rows, ${episodes.length} episodes.`);
    return { daysWritten: dailyRows.length, episodesWritten: episodes.length };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Self-healing freshness check, called at the top of every read path so
 * correctness never depends on the Vercel Cron job in vercel.json actually
 * firing — it's a pre-warming nicety, not a requirement. Cheap on the
 * common case: the FRED CSV fetch itself is cached for an hour (see
 * fetchFredSeriesWithDates), and this skips the DB write entirely if the
 * newest computed row is already the newest stored row.
 */
export async function ensureFreshRegimeData(): Promise<void> {
  await ensureRegimeTables();
  const rows = await query<{ date: string }>("SELECT date::text FROM yield_regime_daily ORDER BY date DESC LIMIT 1");
  const latest = rows[0]?.date ?? null;
  const todayStr = toDateStr(new Date());
  const yesterdayStr = toDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // Treasury data for a given day is normally posted by FRED that same
  // evening, so "today or yesterday" covers the normal case without a
  // holiday calendar; a stale weekend/holiday gap just means the refresh
  // below finds nothing new to write (cheap no-op) rather than needing to
  // be predicted in advance.
  if (latest !== null && latest >= yesterdayStr && latest <= todayStr) return;

  try {
    await refreshRegimeData();
  } catch (err) {
    // Leave existing DB data in place — the read path still returns
    // whatever was last stored, same graceful-degradation convention used
    // everywhere else in this app, rather than failing the whole tab
    // because today's FRED fetch happened to fail.
    console.error(`[yield-regime] refresh failed, serving existing data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface RegimeCurrentState {
  asOfDate: string | null;
  spread: number | null;
  y10: number | null;
  y2: number | null;
  regime: RegimeLabel | null;
  regimeStartDate: string | null;
  daysInRegime: number | null;
}

export async function getCurrentRegimeState(): Promise<RegimeCurrentState> {
  const latestRows = await query<{ date: string; spread: string; y10: string; y2: string; regime: string | null }>(
    "SELECT date::text, spread, y10, y2, regime FROM yield_regime_daily ORDER BY date DESC LIMIT 1"
  );
  const latest = latestRows[0];
  if (!latest) {
    return { asOfDate: null, spread: null, y10: null, y2: null, regime: null, regimeStartDate: null, daysInRegime: null };
  }

  const episodeRows = await query<{ regime: string; start_date: string; duration_trading_days: number }>(
    "SELECT regime, start_date::text, duration_trading_days FROM yield_regime_episodes WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1"
  );
  const currentEpisode = episodeRows[0];

  return {
    asOfDate: latest.date,
    spread: Number(latest.spread),
    y10: Number(latest.y10),
    y2: Number(latest.y2),
    regime: (latest.regime as RegimeLabel | null) ?? null,
    regimeStartDate: currentEpisode?.start_date ?? null,
    daysInRegime: currentEpisode?.duration_trading_days ?? null,
  };
}

const RANGE_TO_DAYS: Record<string, number | null> = {
  "1M": 30,
  "3M": 90,
  "6M": 182,
  "1Y": 365,
  "5Y": 365 * 5,
  Max: null,
};

export async function getRegimeSeries(range: string): Promise<DailyRegimeRow[]> {
  const calendarDays = RANGE_TO_DAYS[range] ?? RANGE_TO_DAYS["1Y"];
  const rows = await query<{
    date: string;
    y10: string;
    y2: string;
    spread: string;
    d10y: string | null;
    d2y: string | null;
    dspread: string | null;
    regime: string | null;
  }>(
    calendarDays === null
      ? "SELECT date::text, y10, y2, spread, d10y, d2y, dspread, regime FROM yield_regime_daily ORDER BY date ASC"
      : `SELECT date::text, y10, y2, spread, d10y, d2y, dspread, regime FROM yield_regime_daily
         WHERE date >= (CURRENT_DATE - $1::int) ORDER BY date ASC`,
    calendarDays === null ? undefined : [calendarDays]
  );

  return rows.map((r) => ({
    date: r.date,
    y10: Number(r.y10),
    y2: Number(r.y2),
    spread: Number(r.spread),
    d10y: r.d10y === null ? null : Number(r.d10y),
    d2y: r.d2y === null ? null : Number(r.d2y),
    dspread: r.dspread === null ? null : Number(r.dspread),
    regime: (r.regime as RegimeLabel | null) ?? null,
  }));
}

export async function getRegimeEpisodes(): Promise<RegimeEpisode[]> {
  const rows = await query<{
    regime: string;
    start_date: string;
    end_date: string | null;
    duration_trading_days: number;
    spread_change: string;
    qqq_pct_change: string | null;
  }>(
    "SELECT regime, start_date::text, end_date::text, duration_trading_days, spread_change, qqq_pct_change FROM yield_regime_episodes ORDER BY start_date DESC"
  );

  return rows.map((r) => ({
    regime: r.regime as RegimeLabel,
    startDate: r.start_date,
    endDate: r.end_date,
    durationTradingDays: r.duration_trading_days,
    spreadChange: Number(r.spread_change),
    qqqPctChange: r.qqq_pct_change === null ? null : Number(r.qqq_pct_change),
  }));
}

export interface OverlayPoint {
  date: string;
  close: number;
}

/**
 * QQQ/TQQQ price overlay for the chart — computed on demand rather than
 * stored, since Massive's Custom Bars is already fast and cached (see
 * lib/massive.ts) and this is just a straight pass-through of daily
 * closes, not a derived/expensive computation like the regime episodes.
 */
export async function getOverlaySeries(symbol: "QQQ" | "TQQQ", range: string): Promise<OverlayPoint[]> {
  const calendarDays = RANGE_TO_DAYS[range] ?? RANGE_TO_DAYS["1Y"];
  const to = new Date();
  const from = calendarDays === null ? new Date(REGIME_BACKFILL_START) : new Date(Date.now() - calendarDays * 24 * 60 * 60 * 1000);
  const bars = await getCustomBars(symbol, { timespan: "day", from: toDateStr(from), to: toDateStr(to) });
  return bars.map((b) => ({ date: toDateStr(new Date(b.t)), close: b.c }));
}
