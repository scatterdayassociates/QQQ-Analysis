// Server-side data + logic for the "T10Y2Y Regime" tab: classifies the
// current 10Y-2Y Treasury yield-curve regime into one of seven states
// (four canonical steepening/flattening regimes, two "mixed" fallbacks, and
// a neutral range-bound state), and overlays that against QQQ/TQQQ price
// action so regime shifts can be visually cross-referenced against equity
// direction.
//
// Unlike every other tab in this app, this one is backed by MySQL (see
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
//   - Treasury yields (primary): FRED's public DGS10/DGS2 series (no API
//     key, same `fredgraph.csv` convention already used by
//     lib/fundamentals.ts for VIXCLS/DTWEXBGS, extended here to also capture
//     the date column since the regime engine needs dated observations, not
//     just a value array).
//   - Treasury yields (backup): Alpha Vantage's TREASURY_YIELD endpoint
//     (same ALPHA_VANTAGE_API_KEY already used elsewhere in this app) —
//     only consulted when FRED's own latest observation is more than 24h
//     old, to fill in whatever gap FRED hasn't closed yet. FRED stays
//     authoritative for every date it does cover; Alpha Vantage only ever
//     supplements dates newer than FRED's own latest, and gets naturally
//     superseded once FRED catches up (every refresh recomputes from
//     scratch, so a later FRED-covered value for the same date simply
//     overwrites the earlier Alpha-Vantage-sourced one). See
//     refreshRegimeData's fallback block below.
//   - QQQ/TQQQ price overlay: Massive's Custom Bars, via the existing
//     lib/massive.ts (same MASSIVE_API_KEY, no new credential).
// All three degrade gracefully: a stale/unreachable FRED fetch (with no
// usable Alpha Vantage backup either) leaves existing DB data in place (the
// read path still returns whatever was last stored, with its own "data as
// of" date), and a failed QQQ fetch just leaves qqqPctChange null for the
// affected episodes rather than failing the tab.
//
// This file must only ever be imported from server code: it reads the
// secret DATABASE_URL (via lib/db.ts), the secret ALPHA_VANTAGE_API_KEY
// directly, and equity data through lib/massive.ts (secret MASSIVE_API_KEY).

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

// Absolute spread-level bands — a second, independent axis from the
// momentum classifier below (Option A from the methodology discussion):
// shown alongside the momentum regime rather than folded into it, since
// "steepening off an inverted base" and "steepening off an already-steep
// base" are genuinely different situations that a single label would
// conflate. Boundaries are configurable fixed bps cutoffs (not
// percentile/z-score bands) for the same reason REGIME_THRESHOLD_BPS is a
// fixed cutoff — simple, explicit, and doesn't shift retroactively as more
// history accumulates. Defaults are round numbers spanning T10Y2Y's
// realistic historical range (roughly -1.0% during the 2022-23 inversion to
// +2.5%+ in 2021).
export const REGIME_LEVEL_DEEP_INVERSION_BPS = envInt("REGIME_LEVEL_DEEP_INVERSION_BPS", -50);
export const REGIME_LEVEL_NORMAL_BPS = envInt("REGIME_LEVEL_NORMAL_BPS", 50);
export const REGIME_LEVEL_STEEP_BPS = envInt("REGIME_LEVEL_STEEP_BPS", 150);

export type SpreadLevelBand = "Deeply Inverted" | "Inverted" | "Flat" | "Normal" | "Steep";

/**
 * Classifies today's spread *level* (not its change) into one of five
 * bands. Pure function of the spread value + the three configured
 * boundaries below, so it's computed on demand at read time rather than
 * stored — a config change (e.g. moving REGIME_LEVEL_NORMAL_BPS) applies
 * retroactively across all history for free, with no reprocessing needed.
 */
export function classifySpreadLevel(spreadPct: number): SpreadLevelBand {
  const bps = spreadPct * 100;
  if (bps < REGIME_LEVEL_DEEP_INVERSION_BPS) return "Deeply Inverted";
  if (bps < 0) return "Inverted";
  if (bps < REGIME_LEVEL_NORMAL_BPS) return "Flat";
  if (bps < REGIME_LEVEL_STEEP_BPS) return "Normal";
  return "Steep";
}

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
  // Deliberately `cache: "no-store"`, not `next: { revalidate: N }` — this
  // is only ever called from refreshRegimeData, which itself is only ever
  // invoked when a caller has already decided a genuinely fresh look at
  // FRED is wanted (the hourly cron, a manual force-refresh, or
  // ensureFreshRegimeData's own "DB looks stale" check). A time-based
  // cache here would apply across *all* of those callers keyed by URL —
  // confirmed live as the reason a manual "force refresh" kept returning
  // the same stale FRED snapshot the hourly cron had already cached
  // earlier that hour, defeating the point of both. Concurrent calls
  // within the same request are already deduped by refreshInFlight below,
  // so there's no remaining upside to caching this fetch.
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, {
    cache: "no-store",
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

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

interface AlphaVantageTreasuryYieldResponse {
  data?: { date: string; value: string }[];
  Information?: string;
  Note?: string;
}

interface AlphaVantageFetchResult {
  obs: FredObservation[];
  // Non-null whenever obs came back empty for a reason worth surfacing
  // (missing key, HTTP failure, rate limit, thrown error) — distinct from
  // "the request succeeded but genuinely had nothing newer than FRED,"
  // which is not an error and isn't reported here. Previously this was only
  // ever console.error'd and silently swallowed, which made "the fallback
  // ran but didn't help" indistinguishable from "the fallback never ran" or
  // "AV is rate-limited" from the UI — all three need different responses
  // from a human debugging staleness, so refreshRegimeData now threads this
  // through to RefreshDiagnostics instead of just logging it.
  error: string | null;
}

/**
 * Backup Treasury yield source, used only when FRED's own latest
 * observation is stale (see the 24h check in refreshRegimeData below).
 * Same ALPHA_VANTAGE_API_KEY already used elsewhere in this app — no new
 * credential. Never throws on failure, since this is already the fallback
 * path: if it doesn't work either, the caller should just keep whatever
 * FRED last gave it rather than erroring out the whole refresh — but the
 * failure reason is still returned (not just logged) so it can reach the UI.
 */
async function fetchAlphaVantageTreasuryYield(maturity: "10year" | "2year"): Promise<AlphaVantageFetchResult> {
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    const error = "ALPHA_VANTAGE_API_KEY is not set";
    console.error(`[yield-regime] ${error} — cannot use the Alpha Vantage Treasury yield fallback.`);
    return { obs: [], error };
  }

  try {
    const url = new URL(ALPHA_VANTAGE_BASE);
    url.searchParams.set("function", "TREASURY_YIELD");
    url.searchParams.set("interval", "daily");
    url.searchParams.set("maturity", maturity);
    url.searchParams.set("apikey", apiKey);
    // Same reasoning as fetchFredSeriesWithDates above: this only ever runs
    // as part of refreshRegimeData, where a stale cached response would
    // silently defeat the whole point of the 24h-staleness fallback.
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      const error = `Alpha Vantage TREASURY_YIELD (${maturity}) request failed: HTTP ${res.status}`;
      console.error(`[yield-regime] ${error}`);
      return { obs: [], error };
    }
    const data = (await res.json()) as AlphaVantageTreasuryYieldResponse;
    if (data.Information || data.Note) {
      const error = `Alpha Vantage TREASURY_YIELD (${maturity}) rate-limited/errored: ${(data.Information || data.Note || "").slice(0, 200)}`;
      console.error(`[yield-regime] ${error}`);
      return { obs: [], error };
    }
    const obs = (data.data ?? [])
      .map((o) => ({ date: o.date, value: Number.parseFloat(o.value) }))
      .filter((o) => Number.isFinite(o.value));
    return { obs, error: null };
  } catch (err) {
    const error = `Alpha Vantage TREASURY_YIELD (${maturity}) lookup threw: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[yield-regime] ${error}`);
    return { obs: [], error };
  }
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
  // Computed on the fly (see classifySpreadLevel), not stored in
  // yield_regime_daily — this is the level axis (Option A), independent of
  // and shown alongside the momentum-based `regime` field above.
  levelBand: SpreadLevelBand;
}

function computeDailyRegimes(obs: AlignedObservation[], lookbackDays: number, thresholdBps: number): DailyRegimeRow[] {
  const thresholdPct = thresholdBps / 100;
  return obs.map((o, i) => {
    const spread = o.y10 - o.y2;
    const levelBand = classifySpreadLevel(spread);
    if (i < lookbackDays) {
      return { date: o.date, y10: o.y10, y2: o.y2, spread, d10y: null, d2y: null, dspread: null, regime: null, levelBand };
    }
    const prior = obs[i - lookbackDays];
    const d10y = o.y10 - prior.y10;
    const d2y = o.y2 - prior.y2;
    const dspread = d10y - d2y; // == spread - prior.spread, per the spec's own equivalence note
    return { date: o.date, y10: o.y10, y2: o.y2, spread, d10y, d2y, dspread, regime: classifyRegime(d2y, d10y, dspread, thresholdPct), levelBand };
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
    const placeholders: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r) => {
      placeholders.push("(?,?,?,?,?,?,?,?)");
      params.push(r.date, r.y10, r.y2, r.spread, r.d10y, r.d2y, r.dspread, r.regime);
    });
    // VALUES(col) (rather than the newer MySQL 8.0.19+ row-alias syntax) is
    // used for the widest compatibility across managed MySQL 8.0.x
    // providers — deprecated but not removed as of 8.0.x.
    await query(
      `INSERT INTO yield_regime_daily (\`date\`, y10, y2, spread, d10y, d2y, dspread, regime)
       VALUES ${placeholders.join(",")}
       ON DUPLICATE KEY UPDATE
         y10 = VALUES(y10), y2 = VALUES(y2), spread = VALUES(spread),
         d10y = VALUES(d10y), d2y = VALUES(d2y), dspread = VALUES(dspread), regime = VALUES(regime)`,
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
      const placeholders: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((ep) => {
        placeholders.push("(?,?,?,?,?,?)");
        params.push(ep.regime, ep.startDate, ep.endDate, ep.durationTradingDays, ep.spreadChange, ep.qqqPctChange);
      });
      await txQuery(
        `INSERT INTO yield_regime_episodes (regime, start_date, end_date, duration_trading_days, spread_change, qqq_pct_change)
         VALUES ${placeholders.join(",")}`,
        params
      );
    }
    return undefined;
  });
}

let refreshInFlight: Promise<{ daysWritten: number; episodesWritten: number }> | null = null;

// Best-effort, in-memory diagnostics for the most recent refresh attempt in
// *this* server instance — reset on every cold start, so this only ever
// reflects "what just happened," not history. Exposed via the API response
// (see getLastRefreshDiagnostics) so a stuck/failing refresh is visible
// directly in the browser instead of requiring Vercel log access, same
// pattern already used for AI Earnings Analysis' fetch diagnostics.
let lastRefreshAttemptAt: string | null = null;
let lastRefreshError: string | null = null;
let lastFredObservedDate: string | null = null;
let usedAlphaVantageFallback = false;
let alphaVantageFallbackDates: string[] = [];
// Distinguishes "fallback never ran (FRED wasn't stale enough yet, or the
// 6h cooldown was still active)" from "fallback ran but had nothing to add"
// from "fallback ran and errored" — usedAlphaVantageFallback alone can't
// tell those apart, which made a silently-empty result indistinguishable
// from a broken ALPHA_VANTAGE_API_KEY from the UI.
let alphaVantageFallbackAttempted = false;
let alphaVantageFallbackError: string | null = null;
// Cross-check only — never written to yield_regime_daily (whose y10/y2
// columns are NOT NULL, so a spread-only observation can't be stored as a
// real row anyway). FRED computes T10Y2Y = DGS10 - DGS2 itself, but its own
// combined series has repeatedly been observed to publish a day *ahead* of
// the individual DGS10/DGS2 series it's derived from (confirmed directly
// against user-downloaded fredgraph.csv exports for DGS10/DGS2, which
// stopped a day short of what FRED's own T10Y2Y series page showed) — a
// FRED-side publish-ordering quirk between its component and derived
// series, not a caching or fetch bug in this app. Surfaced here so that gap
// is visible in the UI instead of looking like stale data.
let lastT10Y2YObservedDate: string | null = null;
let lastT10Y2YObservedValue: number | null = null;

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // the 24h trigger from the spec
// Throttles how often the Alpha Vantage fallback is actually *attempted*
// (not just how often refreshRegimeData runs) — without this, an extended
// FRED outage combined with the hourly cron would burn 2 Alpha Vantage
// requests every single hour, which would exhaust the free tier's daily
// quota in well under a day and start starving every *other* Alpha
// Vantage-dependent feature in this app (Catalyst Tracker's EV/EBITDA and
// earnings data, AI Earnings' fundamentals). Best-effort only: resets on
// cold start, so it's not a hard guarantee under serverless, just a
// reasonable guard against the common case.
const ALPHA_VANTAGE_FALLBACK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastAlphaVantageFallbackAttemptAt = 0;

/**
 * The "daily job" from the spec, reframed as an idempotent function rather
 * than a standalone script: fetch full FRED history, recompute the regime
 * classification and episode table from scratch, and upsert both into
 * MySQL. Recomputing everything (rather than an incremental delta) is
 * deliberately simple — the full DGS10/DGS2-since-2000 history is only a
 * few thousand rows, trivial to reprocess in-memory every time, and this
 * sidesteps an entire class of incremental-update bugs (e.g. a late-arriving
 * FRED revision to a prior day silently going unfixed). Called directly by
 * the cron/manual refresh route on every trigger (no freshness gate — the
 * FRED fetch itself is cheap and cached for an hour, so hourly polling via
 * vercel.json's cron costs little even when there's nothing new to write),
 * and indirectly by ensureFreshRegimeData below for the self-healing case.
 *
 * If FRED's own latest observation is more than 24h old, this also tries
 * Alpha Vantage's TREASURY_YIELD as a backup source for whatever dates FRED
 * hasn't covered yet (see fetchAlphaVantageTreasuryYield) — FRED remains
 * authoritative for every date it does have; Alpha Vantage only ever fills
 * in strictly newer dates, and gets naturally superseded the next time FRED
 * itself covers that date (this function always recomputes from scratch).
 */
export async function refreshRegimeData(): Promise<{ daysWritten: number; episodesWritten: number }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    lastRefreshAttemptAt = new Date().toISOString();
    try {
      await ensureRegimeTables();

      const [y10Obs, y2Obs] = await Promise.all([fetchFredSeriesWithDates("DGS10"), fetchFredSeriesWithDates("DGS2")]);
      let aligned = alignObservations(y10Obs, y2Obs).filter((o) => o.date >= REGIME_BACKFILL_START);
      lastFredObservedDate = aligned.length > 0 ? aligned[aligned.length - 1].date : null;

      // Best-effort cross-check against FRED's own combined T10Y2Y series —
      // never blocks or fails the refresh (see the comment on
      // lastT10Y2YObservedDate above for why this exists).
      try {
        const t10y2yObs = await fetchFredSeriesWithDates("T10Y2Y");
        const latestT10Y2Y = t10y2yObs[t10y2yObs.length - 1];
        lastT10Y2YObservedDate = latestT10Y2Y?.date ?? null;
        lastT10Y2YObservedValue = latestT10Y2Y?.value ?? null;
        if (lastT10Y2YObservedDate && lastFredObservedDate && lastT10Y2YObservedDate > lastFredObservedDate) {
          console.error(
            `[yield-regime] FRED's T10Y2Y series (${lastT10Y2YObservedDate}) is ahead of its own DGS10/DGS2 series (${lastFredObservedDate}) — FRED-side publish lag, not fixable from this app's fetch logic.`
          );
        }
      } catch (err) {
        console.error(`[yield-regime] T10Y2Y cross-check fetch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }

      usedAlphaVantageFallback = false;
      alphaVantageFallbackDates = [];
      alphaVantageFallbackAttempted = false;
      alphaVantageFallbackError = null;
      const staleMs = lastFredObservedDate
        ? Date.now() - new Date(`${lastFredObservedDate}T00:00:00Z`).getTime()
        : Infinity;

      if (staleMs > STALE_THRESHOLD_MS) {
        if (Date.now() - lastAlphaVantageFallbackAttemptAt > ALPHA_VANTAGE_FALLBACK_COOLDOWN_MS) {
          alphaVantageFallbackAttempted = true;
          lastAlphaVantageFallbackAttemptAt = Date.now();
          console.error(
            `[yield-regime] FRED's latest observation (${lastFredObservedDate ?? "none"}) is >24h old — trying the Alpha Vantage TREASURY_YIELD fallback.`
          );
          const [av10, av2] = await Promise.all([fetchAlphaVantageTreasuryYield("10year"), fetchAlphaVantageTreasuryYield("2year")]);
          const avErrors = [av10.error, av2.error].filter((e): e is string => e !== null);
          if (avErrors.length > 0) alphaVantageFallbackError = avErrors.join("; ");

          const avAligned = alignObservations(av10.obs, av2.obs).filter((o) => o.date >= REGIME_BACKFILL_START);
          const newerFromAv = avAligned.filter((o) => !lastFredObservedDate || o.date > lastFredObservedDate);

          if (newerFromAv.length > 0) {
            aligned = [...aligned, ...newerFromAv].sort((a, b) => (a.date < b.date ? -1 : 1));
            usedAlphaVantageFallback = true;
            alphaVantageFallbackDates = newerFromAv.map((o) => o.date);
            console.error(`[yield-regime] Alpha Vantage fallback supplied ${newerFromAv.length} newer observation(s): ${alphaVantageFallbackDates.join(", ")}.`);
          } else if (!alphaVantageFallbackError) {
            console.error("[yield-regime] Alpha Vantage fallback found nothing newer than FRED either — AV's own Treasury yield data hasn't caught up yet.");
          }
        } else {
          console.error(
            `[yield-regime] FRED is >24h stale but the Alpha Vantage fallback cooldown is still active (last attempt ${new Date(lastAlphaVantageFallbackAttemptAt).toISOString()}) — skipping this refresh.`
          );
        }
      }

      const dailyRows = computeDailyRegimes(aligned, REGIME_LOOKBACK_DAYS, REGIME_THRESHOLD_BPS);

      await upsertDailyRows(dailyRows);

      const episodesRaw = buildEpisodes(dailyRows);
      const episodes = await fillQqqPctChange(episodesRaw);
      await replaceEpisodes(episodes);

      lastRefreshError = null;
      console.error(
        `[yield-regime] refreshed: ${dailyRows.length} daily rows, ${episodes.length} episodes. Newest FRED observation: ${lastFredObservedDate ?? "none"}.`
      );
      return { daysWritten: dailyRows.length, episodesWritten: episodes.length };
    } catch (err) {
      lastRefreshError = err instanceof Error ? err.message : String(err);
      throw err;
    }
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
 * fetchFredSeriesWithDates).
 */
export async function ensureFreshRegimeData(): Promise<void> {
  await ensureRegimeTables();
  const rows = await query("SELECT `date` FROM yield_regime_daily ORDER BY `date` DESC LIMIT 1");
  const latest = (rows[0]?.date as string | undefined) ?? null;
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
  } catch {
    // Leave existing DB data in place — the read path still returns
    // whatever was last stored, same graceful-degradation convention used
    // everywhere else in this app, rather than failing the whole tab
    // because today's FRED fetch happened to fail. The error itself is
    // captured in lastRefreshError (set inside refreshRegimeData) and
    // surfaced via getLastRefreshDiagnostics rather than re-logged here.
  }
}

export interface RefreshDiagnostics {
  lastRefreshAttemptAt: string | null;
  lastRefreshError: string | null;
  lastFredObservedDate: string | null; // newest date FRED itself returned on the last attempt, regardless of whether it was new
  usedAlphaVantageFallback: boolean; // true if the last attempt supplemented FRED with Alpha Vantage TREASURY_YIELD data
  alphaVantageFallbackDates: string[]; // which date(s), if any
  alphaVantageFallbackAttempted: boolean; // true if FRED was stale enough (>24h) and the cooldown allowed an actual AV request this refresh
  alphaVantageFallbackError: string | null; // why AV didn't help, if it was attempted but failed (missing key, HTTP error, rate limit) — distinct from "attempted but AV had nothing newer either," which isn't an error
  lastT10Y2YObservedDate: string | null; // FRED's own combined T10Y2Y series latest date, for comparison — see the comment above lastT10Y2YObservedDate's declaration
  lastT10Y2YObservedValue: number | null;
  t10Y2YAheadOfComponents: boolean; // true when T10Y2Y's own latest date is newer than DGS10/DGS2's — a FRED-side publish-lag quirk, not a bug in this app
}

export function getLastRefreshDiagnostics(): RefreshDiagnostics {
  return {
    lastRefreshAttemptAt,
    lastRefreshError,
    lastFredObservedDate,
    usedAlphaVantageFallback,
    alphaVantageFallbackDates,
    alphaVantageFallbackAttempted,
    alphaVantageFallbackError,
    lastT10Y2YObservedDate,
    lastT10Y2YObservedValue,
    t10Y2YAheadOfComponents: Boolean(lastT10Y2YObservedDate && lastFredObservedDate && lastT10Y2YObservedDate > lastFredObservedDate),
  };
}

export interface RegimeCurrentState {
  asOfDate: string | null;
  spread: number | null;
  y10: number | null;
  y2: number | null;
  // The actual inputs to classifyRegime for the latest row — surfaced so
  // the UI can show *why* a given label was assigned (e.g. an elevated
  // spread level with a small dSpread correctly reads "Range-bound", since
  // classification is driven by the lookback-window change, not the level).
  d10y: number | null;
  d2y: number | null;
  dspread: number | null;
  regime: RegimeLabel | null;
  levelBand: SpreadLevelBand | null; // the level axis (Option A) — independent of `regime`, computed on the fly
  regimeStartDate: string | null;
  daysInRegime: number | null;
}

export async function getCurrentRegimeState(): Promise<RegimeCurrentState> {
  const latestRows = await query("SELECT `date`, spread, y10, y2, d10y, d2y, dspread, regime FROM yield_regime_daily ORDER BY `date` DESC LIMIT 1");
  const latest = latestRows[0];
  if (!latest) {
    return {
      asOfDate: null,
      spread: null,
      y10: null,
      y2: null,
      d10y: null,
      d2y: null,
      dspread: null,
      regime: null,
      levelBand: null,
      regimeStartDate: null,
      daysInRegime: null,
    };
  }

  const episodeRows = await query(
    "SELECT regime, start_date, duration_trading_days FROM yield_regime_episodes WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1"
  );
  const currentEpisode = episodeRows[0];

  const spread = Number(latest.spread);
  return {
    asOfDate: latest.date as string,
    spread,
    y10: Number(latest.y10),
    y2: Number(latest.y2),
    d10y: latest.d10y === null ? null : Number(latest.d10y),
    d2y: latest.d2y === null ? null : Number(latest.d2y),
    dspread: latest.dspread === null ? null : Number(latest.dspread),
    regime: (latest.regime as RegimeLabel | null) ?? null,
    levelBand: classifySpreadLevel(spread),
    regimeStartDate: (currentEpisode?.start_date as string | undefined) ?? null,
    daysInRegime: (currentEpisode?.duration_trading_days as number | undefined) ?? null,
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

// "1D"/"5D" are trading-day counts, not calendar-day cutoffs — this data is
// fundamentally daily granularity (FRED doesn't publish intraday Treasury
// yields, so there's no minute-level view to show like the Daypart tab's),
// so these two ranges just mean "the most recent 1 (or 5) trading-day rows
// already in yield_regime_daily," trimmed by row count rather than a
// calendar window so a Friday/Monday boundary doesn't return 0-2 rows
// unpredictably the way a 1-2 calendar-day cutoff would.
const RANGE_ROW_LIMITS: Record<string, number> = {
  "1D": 1,
  "5D": 5,
};

export async function getRegimeSeries(range: string): Promise<DailyRegimeRow[]> {
  const rowLimit = RANGE_ROW_LIMITS[range];
  const calendarDays = rowLimit === undefined ? (RANGE_TO_DAYS[range] ?? RANGE_TO_DAYS["1Y"]) : undefined;

  const rows =
    rowLimit !== undefined
      ? (
          await query(
            "SELECT `date`, y10, y2, spread, d10y, d2y, dspread, regime FROM yield_regime_daily ORDER BY `date` DESC LIMIT ?",
            [rowLimit]
          )
        ).reverse()
      : await query(
          calendarDays === null
            ? "SELECT `date`, y10, y2, spread, d10y, d2y, dspread, regime FROM yield_regime_daily ORDER BY `date` ASC"
            : `SELECT \`date\`, y10, y2, spread, d10y, d2y, dspread, regime FROM yield_regime_daily
               WHERE \`date\` >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY \`date\` ASC`,
          calendarDays === null ? undefined : [calendarDays]
        );

  return rows.map((r) => {
    const spread = Number(r.spread);
    return {
      date: r.date as string,
      y10: Number(r.y10),
      y2: Number(r.y2),
      spread,
      d10y: r.d10y === null ? null : Number(r.d10y),
      d2y: r.d2y === null ? null : Number(r.d2y),
      dspread: r.dspread === null ? null : Number(r.dspread),
      regime: (r.regime as RegimeLabel | null) ?? null,
      levelBand: classifySpreadLevel(spread),
    };
  });
}

export async function getRegimeEpisodes(): Promise<RegimeEpisode[]> {
  const rows = await query(
    "SELECT regime, start_date, end_date, duration_trading_days, spread_change, qqq_pct_change FROM yield_regime_episodes ORDER BY start_date DESC"
  );

  return rows.map((r) => ({
    regime: r.regime as RegimeLabel,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    durationTradingDays: r.duration_trading_days as number,
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
  const rowLimit = RANGE_ROW_LIMITS[range];
  const to = new Date();

  if (rowLimit !== undefined) {
    // Fetch a generous calendar buffer (weekends/holidays mean N trading
    // days can span more than N calendar days) then keep just the last
    // rowLimit bars — getCustomBars already returns them sorted ascending.
    const from = new Date(Date.now() - (rowLimit + 10) * 24 * 60 * 60 * 1000);
    const bars = await getCustomBars(symbol, { timespan: "day", from: toDateStr(from), to: toDateStr(to) });
    return bars.slice(-rowLimit).map((b) => ({ date: toDateStr(new Date(b.t)), close: b.c }));
  }

  const calendarDays = RANGE_TO_DAYS[range] ?? RANGE_TO_DAYS["1Y"];
  const from = calendarDays === null ? new Date(REGIME_BACKFILL_START) : new Date(Date.now() - calendarDays * 24 * 60 * 60 * 1000);
  const bars = await getCustomBars(symbol, { timespan: "day", from: toDateStr(from), to: toDateStr(to) });
  return bars.map((b) => ({ date: toDateStr(new Date(b.t)), close: b.c }));
}
