// Server-side data + logic for the "AI Earnings Analysis" tab: an AI-capex
// buyer fragility screen, ported from an uploaded reference implementation
// (config.py / fundamentals.py / scoring.py / alphavantage_client.py).
//
// Thesis: capex *level* isn't the signal — funding *source* is. Screens a
// small universe of AI infrastructure buyers on whether they're still
// funding capex from operating cash flow, or increasingly from debt/equity
// issuance, then combines four metrics into one cross-sectional z-scored
// composite (higher = more fragile). See the per-metric comments below for
// exactly what each one captures — mirrors the reference implementation's
// README table.
//
// Data source: AlphaVantage's CASH_FLOW, INCOME_STATEMENT, and OVERVIEW
// endpoints (reuses the same ALPHA_VANTAGE_API_KEY already configured for
// Catalyst Tracker — no new key needed). Unlike every other external call
// in this app, these have no bulk/all-companies mode: 3 endpoints x 9
// tickers = 27 requests per full sweep, a real chunk of the free tier's
// daily quota — and firing them concurrently (this file's original
// Promise.all fan-out) reliably tripped Alpha Vantage's "burst pattern
// detected" limiter, which flags request *clustering* independently of the
// raw per-second count. Fixed two ways, together: (1) every real request
// now goes through a single sequential queue (`sequenced`) with a
// randomized 1-3s gap between calls, and (2) the whole sweep's result is
// cached in-memory for 24h (`getAiEarningsCoreData`/`coreCache`) and
// pre-warmed once a day by a Vercel Cron job (vercel.json ->
// /api/ai-earnings/refresh), so an ordinary page view just reads the cache
// instead of re-running all 27 requests — previously every tab view (every
// component mount) re-ran the full sweep, whether or not anything had
// changed. Same "cache + cron pre-warm + inline fallback on cache miss"
// shape already used for the T10Y2Y Regime tab's MySQL refresh.
//
// Options richness cross-reference (optional, only computed when a caller
// passes an expiration date): compares the options market's *implied* move
// into the next earnings report (ATM straddle price / spot, via Massive's
// Options Chain Snapshot) against each ticker's own trailing *realized*
// 1-day earnings-day moves (via Alpha Vantage's EARNINGS report dates +
// Massive daily bars) — a richness ratio above 1.0 means the market is
// pricing in a bigger move than this ticker has historically delivered.
// Requires a Massive Options-tier subscription (confirmed live and
// separate from the base plan's stock/aggregates access already used
// elsewhere in this app) plus the same MASSIVE_API_KEY.
//
// This file must only ever be imported from server code: it reads the
// secret ALPHA_VANTAGE_API_KEY directly.

import { getCustomBars, getOptionChainSnapshot } from "./massive";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
const FUNDAMENTALS_CACHE_SECONDS = 86_400; // 24h — fundamentals barely move intraday or even day-to-day

// Alpha Vantage's free tier flags clusters of near-simultaneous requests as
// a "burst pattern" ("query no more than 5 requests per second... spread
// out your API requests more evenly") even when the raw per-second count is
// technically under its cap — confirmed live: this file's original
// Promise.all fan-out (18-27 requests fired essentially at once per full
// screen refresh) reliably tripped it for CASH_FLOW/INCOME_STATEMENT calls.
// Every real Alpha Vantage request in this file now goes through a single
// sequential queue (see `sequenced` below) with a randomized 1-3s gap
// between requests instead of firing concurrently.
const REQUEST_SPACING_MIN_MS = 1_000;
const REQUEST_SPACING_MAX_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSpacingMs(): number {
  return REQUEST_SPACING_MIN_MS + Math.random() * (REQUEST_SPACING_MAX_MS - REQUEST_SPACING_MIN_MS);
}

// Runs `fn` once per item, strictly one at a time, waiting a randomized
// 1-3s between calls (not after the last one).
async function sequenced<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await fn(items[i]));
    if (i < items.length - 1) await sleep(randomSpacingMs());
  }
  return results;
}

export interface AiEarningsTicker {
  ticker: string;
  name: string;
  tier: 1 | 2 | 3 | 4; // 1 = hyperscaler, 2 = leveraged buyer, 3 = credit-risk tail, 4 = memory makers
}

// The buyer universe, tiered per the reference implementation's thesis.
// Tier 4 (memory makers) is a separate category from the original
// hyperscaler/leveraged-buyer/credit-risk framing — these are AI-capex
// *suppliers* (memory/storage), not buyers, included as a related but
// distinct cohort rather than force-fit into tiers 1-3.
export const AI_EARNINGS_UNIVERSE: AiEarningsTicker[] = [
  { ticker: "GOOGL", name: "Alphabet", tier: 1 },
  { ticker: "MSFT", name: "Microsoft", tier: 1 },
  { ticker: "META", name: "Meta Platforms", tier: 1 },
  { ticker: "AMZN", name: "Amazon", tier: 1 },
  { ticker: "ORCL", name: "Oracle", tier: 2 },
  { ticker: "CRWV", name: "CoreWeave", tier: 3 },
  { ticker: "SKHY", name: "SK Hynix", tier: 4 },
  { ticker: "MU", name: "Micron", tier: 4 },
  { ticker: "SNDK", name: "Sandisk", tier: 4 },
];

// Weights for the composite Buyer Fragility Score — same as the reference
// implementation's config.py SCORE_WEIGHTS.
const SCORE_WEIGHTS: Record<string, number> = {
  capexCoverageInverse: 0.3, // low OCF/capex -> fragile
  capexToRevenue: 0.2, // high capex intensity -> fragile
  financingDependency: 0.3, // high debt+equity issuance vs capex -> fragile
  coverageTrend: 0.2, // deteriorating trend q/q -> fragile
};

interface AlphaVantageQuarterlyReport {
  fiscalDateEnding?: string;
  [key: string]: string | undefined;
}

interface AlphaVantageStatementResponse {
  quarterlyReports?: AlphaVantageQuarterlyReport[];
  Information?: string;
  Note?: string;
}

// AlphaVantage returns numeric fields as strings, and the literal string
// "None" for missing values (e.g. no buybacks that quarter).
function toFloat(x: string | undefined): number {
  if (x === undefined || x === "None" || x === "") return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// `notes` collects one human-readable reason per failure (missing key, HTTP
// status, rate-limit message, etc.) so the *actual* cause of a "0/6 tickers"
// result is visible in the API response and the UI, not just Vercel's
// server console — this is what showed up as "No tickers returned usable
// fundamentals data" with no further explanation before this was added.
async function fetchStatement(
  function_: "CASH_FLOW" | "INCOME_STATEMENT",
  ticker: string,
  notes: string[]
): Promise<AlphaVantageQuarterlyReport[] | null> {
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    notes.push(`${ticker} ${function_}: ALPHA_VANTAGE_API_KEY is not set`);
    return null;
  }

  try {
    const url = new URL(ALPHA_VANTAGE_BASE);
    url.searchParams.set("function", function_);
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("apikey", apiKey);
    const res = await fetch(url.toString(), { next: { revalidate: FUNDAMENTALS_CACHE_SECONDS } });
    if (!res.ok) {
      const msg = `${ticker} ${function_}: HTTP ${res.status}`;
      console.error(`[ai-earnings] Alpha Vantage ${function_} request failed for ${ticker}: ${res.status}`);
      notes.push(msg);
      return null;
    }
    const data = (await res.json()) as AlphaVantageStatementResponse;
    if (data.Information || data.Note) {
      const reason = (data.Information || data.Note || "").slice(0, 200);
      console.error(`[ai-earnings] Alpha Vantage ${function_} rate-limited/errored for ${ticker}: ${reason}`);
      notes.push(`${ticker} ${function_}: ${reason}`);
      return null;
    }
    if (!data.quarterlyReports || data.quarterlyReports.length === 0) {
      notes.push(`${ticker} ${function_}: response had no quarterlyReports`);
      return null;
    }
    return data.quarterlyReports;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-earnings] Alpha Vantage ${function_} lookup threw for ${ticker}: ${msg}`);
    notes.push(`${ticker} ${function_}: ${msg}`);
    return null;
  }
}

interface AlphaVantageOverviewResponse {
  EVToEBITDA?: string;
  Information?: string;
  Note?: string;
}

/**
 * Alpha Vantage's OVERVIEW endpoint (function=OVERVIEW&symbol=X) — the
 * source for EV/EBITDA, a valuation ratio orthogonal to the capex/financing
 * metrics fetched above. One request per ticker (no bulk mode), same
 * convention as the rest of this file's Alpha Vantage calls. Previously
 * fetched trailing P/E; swapped for EV/EBITDA (per request, matching
 * Catalyst Tracker's own P/E-to-EV/EBITDA swap) since it's
 * capital-structure-neutral — accounts for debt/cash on the balance sheet,
 * unlike P/E — and comparable across this universe's very different
 * leverage profiles (hyperscalers vs. CoreWeave vs. memory makers).
 * EVToEBITDA comes back as the literal string "None" when EBITDA is
 * negative/unavailable — those resolve to null rather than a misleading
 * number.
 */
async function getEvToEbitdaByTicker(tickers: string[], notes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    notes.push("EV/EBITDA: ALPHA_VANTAGE_API_KEY is not set");
    return result;
  }

  await sequenced(tickers, async (ticker) => {
    try {
      const url = new URL(ALPHA_VANTAGE_BASE);
      url.searchParams.set("function", "OVERVIEW");
      url.searchParams.set("symbol", ticker);
      url.searchParams.set("apikey", apiKey);
      const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
      if (!res.ok) {
        notes.push(`${ticker} OVERVIEW: HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as AlphaVantageOverviewResponse;
      if (data.Information || data.Note) {
        notes.push(`${ticker} OVERVIEW: ${(data.Information || data.Note || "").slice(0, 200)}`);
        return;
      }
      const evToEbitda = Number(data.EVToEBITDA);
      if (data.EVToEBITDA && data.EVToEBITDA !== "None" && Number.isFinite(evToEbitda)) {
        result.set(ticker, evToEbitda);
      } else {
        notes.push(`${ticker} OVERVIEW: no usable EVToEBITDA (${data.EVToEBITDA ?? "missing"})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ai-earnings] Alpha Vantage OVERVIEW lookup threw for ${ticker}: ${msg}`);
      notes.push(`${ticker} OVERVIEW: ${msg}`);
    }
  });

  return result;
}

export interface QuarterMetrics {
  fiscalDateEnding: string;
  operatingCashFlow: number;
  capex: number;
  revenue: number;
  debtIssued: number;
  equityIssued: number;
  buybacks: number;
  interestExpense: number;
}

function capexCoverageRatio(q: QuarterMetrics): number | null {
  if (q.capex === 0) return null;
  return q.operatingCashFlow / q.capex;
}

function capexToRevenue(q: QuarterMetrics): number | null {
  if (q.revenue === 0) return null;
  return q.capex / q.revenue;
}

function financingDependency(q: QuarterMetrics): number | null {
  if (q.capex === 0) return null;
  return (q.debtIssued + q.equityIssued) / q.capex;
}

// Pulls and aligns cash flow + income statement quarters by fiscalDateEnding
// for every ticker, as ONE flat sequential queue of CASH_FLOW/INCOME_STATEMENT
// jobs across the whole universe (18 requests for 9 tickers) rather than
// per-ticker Promise.all pairs — see the `sequenced` helper's comment above;
// fanning these out concurrently (even 2 at a time per ticker) was enough to
// trip Alpha Vantage's burst detector across the full 9-ticker universe.
// Returns most-recent-first quarters per ticker, up to numQuarters; null for
// a ticker if either of its statements is unavailable (missing key,
// rate-limited, or errored) — the caller treats that ticker as having no
// data rather than failing the whole screen.
type StatementKind = "CASH_FLOW" | "INCOME_STATEMENT";

async function getQuarterlyMetricsByTicker(
  tickers: string[],
  notes: string[],
  numQuarters = 8
): Promise<Map<string, QuarterMetrics[] | null>> {
  const raw = new Map<string, { cf: AlphaVantageQuarterlyReport[] | null; inc: AlphaVantageQuarterlyReport[] | null }>();
  for (const ticker of tickers) raw.set(ticker, { cf: null, inc: null });

  // Checked once up front (rather than letting each of the 18 jobs discover
  // it individually via fetchStatement) so a missing key skips straight to
  // an empty result instead of still paying the full ~30s of inter-request
  // spacing for jobs that were never going to make a real request anyway.
  if (!process.env.ALPHA_VANTAGE_API_KEY?.trim()) {
    notes.push("CASH_FLOW/INCOME_STATEMENT: ALPHA_VANTAGE_API_KEY is not set");
    return new Map(tickers.map((t) => [t, null]));
  }

  const jobs: { ticker: string; kind: StatementKind }[] = [];
  for (const ticker of tickers) {
    jobs.push({ ticker, kind: "CASH_FLOW" });
    jobs.push({ ticker, kind: "INCOME_STATEMENT" });
  }

  await sequenced(jobs, async ({ ticker, kind }) => {
    const data = await fetchStatement(kind, ticker, notes);
    const entry = raw.get(ticker)!;
    if (kind === "CASH_FLOW") entry.cf = data;
    else entry.inc = data;
  });

  const result = new Map<string, QuarterMetrics[] | null>();
  for (const ticker of tickers) {
    const { cf, inc } = raw.get(ticker)!;
    if (!cf || !inc) {
      result.set(ticker, null);
      continue;
    }
    const incByDate = new Map(inc.map((q) => [q.fiscalDateEnding, q]));
    result.set(
      ticker,
      cf.slice(0, numQuarters).map((q) => {
        const date = q.fiscalDateEnding ?? "";
        const incQ = incByDate.get(date) ?? {};
        return {
          fiscalDateEnding: date,
          operatingCashFlow: toFloat(q.operatingCashflow),
          capex: toFloat(q.capitalExpenditures),
          revenue: toFloat(incQ.totalRevenue),
          debtIssued: toFloat(q.proceedsFromIssuanceOfLongTermDebt),
          equityIssued: toFloat(q.proceedsFromIssuanceOfCommonStock),
          buybacks: toFloat(q.paymentsForRepurchaseOfCommonStock),
          interestExpense: toFloat(incQ.interestExpense),
        };
      })
    );
  }
  return result;
}

// Slope proxy: most recent coverage ratio minus the ratio 4 quarters ago
// (year-over-year direction, controlling for seasonality in capex timing).
// Negative = deteriorating = fragile.
function coverageTrend(quarters: QuarterMetrics[]): number | null {
  if (quarters.length < 5) return null;
  const recent = capexCoverageRatio(quarters[0]);
  const yearAgo = capexCoverageRatio(quarters[4]);
  if (recent === null || yearAgo === null) return null;
  return recent - yearAgo;
}

// Buybacks this quarter minus buybacks a year ago. Sharply negative
// (buybacks cut or zeroed) is a leading fragility tell — usually the first
// lever management pulls before touching the dividend or the capex plan.
function buybackDeltaYoy(quarters: QuarterMetrics[]): number | null {
  if (quarters.length < 5) return null;
  return quarters[0].buybacks - quarters[4].buybacks;
}

function interestExpenseYoyGrowth(quarters: QuarterMetrics[]): number | null {
  if (quarters.length < 5) return null;
  const prior = quarters[4].interestExpense;
  if (prior === 0) return null;
  return (quarters[0].interestExpense - prior) / prior;
}

// Averages financing_dependency over the trailing n quarters instead of
// latest-quarter-only. A single outsized one-off equity raise can make a
// name that just crossed the line look more fragile than one that has been
// persistently funding capex externally for years — structural dependency
// should outrank a one-time event until confirmed as a pattern.
function trailingAverage(quarters: QuarterMetrics[], metric: (q: QuarterMetrics) => number | null, n = 4): number | null {
  const vals = quarters.slice(0, n).map(metric).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export interface AiEarningsScore {
  ticker: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  evToEbitda: number | null; // EV/EBITDA, null if EBITDA is negative/unavailable
  latestQuarter: string;
  capexCoverageRatio: number | null;
  capexToRevenue: number | null; // trailing 4Q average
  financingDependency: number | null; // trailing 4Q average
  coverageTrend: number | null;
  buybackDeltaYoy: number | null;
  interestExpenseYoyGrowth: number | null;
  fragilityScore: number | null;
}

function zscore(values: number[], x: number | null): number | null {
  const clean = values.filter((v): v is number => v !== null && v !== undefined);
  if (x === null || clean.length < 2) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (clean.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return 0;
  return (x - mean) / stdev;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getSpotPrice(ticker: string): Promise<number | null> {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 10); // pad past weekends/holidays for a guaranteed last close
  const bars = await getCustomBars(ticker, { timespan: "day", from: toDateStr(from), to: toDateStr(to) });
  if (bars.length === 0) return null;
  return bars[bars.length - 1].c;
}

export interface AtmStraddle {
  spotPrice: number;
  atmStrike: number;
  callPrice: number | null;
  putPrice: number | null;
  straddlePrice: number | null;
  impliedMovePct: number | null; // straddlePrice / spotPrice
}

// ATM straddle price / spot, as a proxy for the options market's implied
// move by the given expiration. Picks the single strike closest to spot and
// sums call + put day.close (the only price field the real snapshot
// response carries — see getOptionChainSnapshot's doc comment).
async function computeAtmStraddle(ticker: string, expirationDate: string): Promise<AtmStraddle | null> {
  try {
    const [spot, chain] = await Promise.all([
      getSpotPrice(ticker),
      getOptionChainSnapshot(ticker, { expirationDate }),
    ]);
    if (spot === null || chain.length === 0) return null;

    const strikes = [...new Set(chain.map((c) => c.details.strike_price))];
    const atmStrike = strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);

    const callPrice = chain.find((c) => c.details.strike_price === atmStrike && c.details.contract_type === "call")?.day?.close ?? null;
    const putPrice = chain.find((c) => c.details.strike_price === atmStrike && c.details.contract_type === "put")?.day?.close ?? null;
    const straddlePrice = callPrice !== null && putPrice !== null ? callPrice + putPrice : null;
    const impliedMovePct = straddlePrice !== null && spot > 0 ? straddlePrice / spot : null;

    return { spotPrice: spot, atmStrike, callPrice, putPrice, straddlePrice, impliedMovePct };
  } catch (err) {
    console.error(`[ai-earnings] options straddle lookup failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// A module-local historical-report-dates + close-to-close-reaction lookup,
// deliberately not cross-imported from lib/catalysts.ts (this app's
// established convention — see lib/overnightGap.ts's independent Finnhub
// call — is per-module duplication over cross-file coupling for these
// small, source-specific lookups). Reuses the same Alpha Vantage EARNINGS
// endpoint and cache duration as fetchStatement above.
async function getHistoricalReportDates(ticker: string, numQuarters: number): Promise<string[]> {
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) return [];

  try {
    const url = new URL(ALPHA_VANTAGE_BASE);
    url.searchParams.set("function", "EARNINGS");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("apikey", apiKey);
    const res = await fetch(url.toString(), { next: { revalidate: FUNDAMENTALS_CACHE_SECONDS } });
    if (!res.ok) return [];
    const data = (await res.json()) as { quarterlyEarnings?: { reportedDate?: string }[]; Information?: string; Note?: string };
    if (data.Information || data.Note) return [];
    return (data.quarterlyEarnings ?? [])
      .map((q) => q.reportedDate)
      .filter((d): d is string => !!d)
      .sort()
      .reverse()
      .slice(0, numQuarters);
  } catch (err) {
    console.error(`[ai-earnings] historical report dates lookup threw for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export interface OptionsRichness {
  ticker: string;
  expirationDate: string;
  straddle: AtmStraddle | null;
  historicalMoveCount: number;
  avgRealizedAbsMovePct: number | null;
  richnessRatio: number | null; // impliedMovePct / avgRealizedAbsMovePct
}

const HISTORICAL_MOVE_QUARTERS = 12;

async function getOptionsRichness(ticker: string, expirationDate: string): Promise<OptionsRichness> {
  const empty: OptionsRichness = {
    ticker,
    expirationDate,
    straddle: null,
    historicalMoveCount: 0,
    avgRealizedAbsMovePct: null,
    richnessRatio: null,
  };

  try {
    const reportDates = await getHistoricalReportDates(ticker, HISTORICAL_MOVE_QUARTERS);
    const straddlePromise = computeAtmStraddle(ticker, expirationDate);

    if (reportDates.length === 0) {
      return { ...empty, straddle: await straddlePromise };
    }

    const earliest = new Date(reportDates[reportDates.length - 1]);
    earliest.setDate(earliest.getDate() - 7); // lead a few days so the prior trading day's close is in range
    const [straddle, bars] = await Promise.all([
      straddlePromise,
      getCustomBars(ticker, { timespan: "day", from: toDateStr(earliest), to: toDateStr(new Date()) }),
    ]);

    const closesByDate = new Map(bars.map((b) => [toDateStr(new Date(b.t)), b.c]));
    const sortedDates = [...closesByDate.keys()].sort();

    const absMoves: number[] = [];
    for (const reportedDate of reportDates) {
      const idx = sortedDates.indexOf(reportedDate);
      if (idx <= 0) continue; // no bar that day, or no prior trading day to compare against
      const eventClose = closesByDate.get(sortedDates[idx])!;
      const priorClose = closesByDate.get(sortedDates[idx - 1])!;
      if (priorClose === 0) continue;
      absMoves.push(Math.abs((eventClose - priorClose) / priorClose));
    }

    const avgRealizedAbsMovePct = absMoves.length > 0 ? absMoves.reduce((a, b) => a + b, 0) / absMoves.length : null;
    const richnessRatio =
      straddle?.impliedMovePct != null && avgRealizedAbsMovePct !== null && avgRealizedAbsMovePct > 0
        ? straddle.impliedMovePct / avgRealizedAbsMovePct
        : null;

    return { ticker, expirationDate, straddle, historicalMoveCount: absMoves.length, avgRealizedAbsMovePct, richnessRatio };
  } catch (err) {
    console.error(`[ai-earnings] options richness lookup failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}

export interface AiEarningsData {
  asOf: string;
  scores: AiEarningsScore[];
  tickersWithData: number;
  tickersRequested: number;
  optionsRichness?: OptionsRichness[];
  // Per-ticker/statement failure reasons (missing key, HTTP status, Alpha
  // Vantage rate-limit text) — present whenever any fetch failed, even if
  // other tickers still came through, so a "0/6" or partial result is
  // debuggable from the browser instead of requiring Vercel log access.
  diagnostics?: string[];
}

type AiEarningsCoreData = Omit<AiEarningsData, "optionsRichness">;

// Does the real work: the full sequenced Alpha Vantage sweep (CASH_FLOW +
// INCOME_STATEMENT for every ticker, then OVERVIEW for every ticker — never
// concurrently, see `sequenced` above) plus the fragility scoring. This is
// the slow, quota-hungry, burst-prone part (27 sequenced requests, ~30-80s
// wall time) — kept separate from getAiEarningsCoreData's caching below so
// it only ever runs from a controlled trigger (the daily cron, or a cache
// miss), never once per page view.
async function computeCoreAiEarningsData(): Promise<AiEarningsCoreData> {
  const notes: string[] = [];
  const tickers = AI_EARNINGS_UNIVERSE.map((t) => t.ticker);

  // Statements first, then EV/EBITDA — sequential phases, not concurrent
  // Promise.all, so every one of the 27 real Alpha Vantage requests this
  // function makes is spaced 1-3s from its neighbor, never just its
  // within-phase neighbor.
  const quartersByTicker = await getQuarterlyMetricsByTicker(tickers, notes);
  const evToEbitdaByTicker = await getEvToEbitdaByTicker(tickers, notes);

  // Every ticker in AI_EARNINGS_UNIVERSE gets a row, always — previously a
  // ticker with a failed/rate-limited CASH_FLOW or INCOME_STATEMENT fetch
  // was dropped from the table entirely, which made the row count swing
  // unpredictably (1, 2, 5...) load to load purely based on which of the
  // concurrent Alpha Vantage requests happened to clear the rate limit that
  // particular time. A missing fetch now just leaves that ticker's metrics
  // null (rendered as "—" in the UI) instead of erasing the row, so the
  // table is always exactly tickersRequested rows long. tickersWithData
  // still reports how many tickers had real quarterly data this load, for
  // the "(X/9 tickers returned data)" indicator above the table.
  let tickersWithFundamentals = 0;
  const raw: (Omit<AiEarningsScore, "fragilityScore"> & { fragilityScore: null })[] = [];
  for (const meta of AI_EARNINGS_UNIVERSE) {
    const quarters = quartersByTicker.get(meta.ticker) ?? null;
    const hasQuarters = quarters !== null && quarters.length > 0;
    if (hasQuarters) tickersWithFundamentals++;
    const latest = hasQuarters ? quarters![0] : null;
    raw.push({
      ticker: meta.ticker,
      name: meta.name,
      tier: meta.tier,
      evToEbitda: evToEbitdaByTicker.get(meta.ticker) ?? null,
      latestQuarter: latest?.fiscalDateEnding ?? "",
      capexCoverageRatio: latest ? capexCoverageRatio(latest) : null,
      capexToRevenue: hasQuarters ? trailingAverage(quarters!, capexToRevenue) : null,
      financingDependency: hasQuarters ? trailingAverage(quarters!, financingDependency) : null,
      coverageTrend: hasQuarters ? coverageTrend(quarters!) : null,
      buybackDeltaYoy: hasQuarters ? buybackDeltaYoy(quarters!) : null,
      interestExpenseYoyGrowth: hasQuarters ? interestExpenseYoyGrowth(quarters!) : null,
      fragilityScore: null,
    });
  }

  // Cross-sectional inputs for z-scoring (recalibrates automatically as
  // tickers are added/removed from AI_EARNINGS_UNIVERSE — no hardcoded
  // "good"/"bad" thresholds to keep updated by hand).
  const coverageVals = raw.map((s) => s.capexCoverageRatio).filter((v): v is number => v !== null);
  const ratioVals = raw.map((s) => s.capexToRevenue).filter((v): v is number => v !== null);
  const financingVals = raw.map((s) => s.financingDependency).filter((v): v is number => v !== null);
  const trendVals = raw.map((s) => s.coverageTrend).filter((v): v is number => v !== null);

  const scores: AiEarningsScore[] = raw.map((s) => {
    // Invert coverage: LOW coverage ratio = fragile, so negate the z-score.
    const coverageZ = zscore(coverageVals, s.capexCoverageRatio);
    const coverageInverseZ = coverageZ !== null ? -coverageZ : null;

    const ratioZ = zscore(ratioVals, s.capexToRevenue);
    const financingZ = zscore(financingVals, s.financingDependency);

    // Invert trend: NEGATIVE trend (deteriorating) = fragile.
    const trendZ = zscore(trendVals, s.coverageTrend);
    const trendInverseZ = trendZ !== null ? -trendZ : null;

    const components: Record<string, number | null> = {
      capexCoverageInverse: coverageInverseZ,
      capexToRevenue: ratioZ,
      financingDependency: financingZ,
      coverageTrend: trendInverseZ,
    };

    let weightedSum = 0;
    let weightUsed = 0;
    for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
      const val = components[key];
      if (val !== null) {
        weightedSum += val * weight;
        weightUsed += weight;
      }
    }

    return { ...s, fragilityScore: weightUsed > 0 ? weightedSum / weightUsed : null };
  });

  scores.sort((a, b) => {
    if (a.fragilityScore === null && b.fragilityScore === null) return 0;
    if (a.fragilityScore === null) return 1;
    if (b.fragilityScore === null) return -1;
    return b.fragilityScore - a.fragilityScore;
  });

  console.error(
    `[ai-earnings] ${tickersWithFundamentals}/${AI_EARNINGS_UNIVERSE.length} tickers returned usable fundamentals data (all ${scores.length} still shown in the table).`
  );

  return {
    asOf: new Date().toISOString().slice(0, 10),
    scores,
    tickersWithData: tickersWithFundamentals,
    tickersRequested: AI_EARNINGS_UNIVERSE.length,
    ...(notes.length > 0 ? { diagnostics: notes } : {}),
  };
}

// In-memory cache for the core fundamentals screen — resets on cold start
// (same best-effort convention already used for the T10Y2Y Regime tab's
// Alpha Vantage fallback cooldown and this app's other in-memory caches),
// but combined with the daily cron below, this is what turns "27 sequenced
// Alpha Vantage requests, once per page view" into "once per 24h": every
// ordinary tab load just returns whatever's already cached, at zero Alpha
// Vantage cost, instead of re-running the sweep.
const CORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let coreCache: (AiEarningsCoreData & { fetchedAt: number }) | null = null;
let coreCacheInFlight: Promise<AiEarningsCoreData> | null = null;

/**
 * Returns the core fundamentals screen, using the in-memory cache if it's
 * under 24h old. On a cache miss (cold start, or first run ever before the
 * daily cron has fired) this runs the full sequenced sweep inline — slow
 * (~30-80s) but correct, and only ever hit once until the cron catches up.
 * Concurrent callers during a cold cache share one in-flight computation
 * (`coreCacheInFlight`) rather than each kicking off their own 27-request
 * sweep, which would just recreate the exact burst problem this was built
 * to fix.
 */
export async function getAiEarningsCoreData(): Promise<AiEarningsCoreData> {
  if (coreCache && Date.now() - coreCache.fetchedAt < CORE_CACHE_TTL_MS) {
    const { fetchedAt: _fetchedAt, ...data } = coreCache;
    return data;
  }
  if (coreCacheInFlight) return coreCacheInFlight;

  coreCacheInFlight = (async () => {
    const data = await computeCoreAiEarningsData();
    coreCache = { ...data, fetchedAt: Date.now() };
    return data;
  })();

  try {
    return await coreCacheInFlight;
  } finally {
    coreCacheInFlight = null;
  }
}

/** Forces a fresh sequenced sweep regardless of cache age — used by the daily cron (see app/api/ai-earnings/refresh/route.ts) to pre-warm getAiEarningsCoreData for every ordinary page view that day. */
export async function refreshAiEarningsCoreData(): Promise<void> {
  if (coreCacheInFlight) {
    await coreCacheInFlight;
    return;
  }
  coreCacheInFlight = computeCoreAiEarningsData();
  try {
    const data = await coreCacheInFlight;
    coreCache = { ...data, fetchedAt: Date.now() };
  } finally {
    coreCacheInFlight = null;
  }
}

export async function getAiEarningsData(expiration?: string): Promise<AiEarningsData> {
  const core = await getAiEarningsCoreData();

  let optionsRichness: OptionsRichness[] | undefined;
  if (expiration) {
    // Sequenced (not Promise.all) since getOptionsRichness's historical-move
    // lookup hits Alpha Vantage's EARNINGS endpoint once per ticker — see
    // the `sequenced` helper's comment above. Deliberately not covered by
    // the 24h core cache: it's user-triggered (the "Load Options Richness"
    // button) for a specific expiration date, not an automatic per-load
    // fetch, so it isn't the source of the burst problem the cache above
    // fixes, and caching it would show stale straddle prices.
    optionsRichness = await sequenced(AI_EARNINGS_UNIVERSE, (t) => getOptionsRichness(t.ticker, expiration));
    const withStraddle = optionsRichness.filter((r) => r.straddle?.straddlePrice != null).length;
    console.error(
      `[ai-earnings] options richness for ${expiration}: ${withStraddle}/${AI_EARNINGS_UNIVERSE.length} tickers returned a straddle price.`
    );
  }

  return {
    ...core,
    ...(optionsRichness ? { optionsRichness } : {}),
  };
}
