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
// Data source: AlphaVantage's CASH_FLOW and INCOME_STATEMENT endpoints
// (reuses the same ALPHA_VANTAGE_API_KEY already configured for Catalyst
// Tracker — no new key needed). Unlike every other external call in this
// app, these have no bulk/all-companies mode: 2 endpoints x 6 tickers = 12
// requests per fetch, a real chunk of the free tier's daily quota. Cached
// for 24 hours (longer than anything else in this app) since quarterly
// fundamentals only change 4x/year per ticker — there's no reason to
// re-spend quota more often than that.
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

export interface AiEarningsTicker {
  ticker: string;
  name: string;
  tier: 1 | 2 | 3; // 1 = hyperscaler, 2 = leveraged buyer, 3 = credit-risk tail
}

// The buyer universe, tiered per the reference implementation's thesis.
export const AI_EARNINGS_UNIVERSE: AiEarningsTicker[] = [
  { ticker: "GOOGL", name: "Alphabet", tier: 1 },
  { ticker: "MSFT", name: "Microsoft", tier: 1 },
  { ticker: "META", name: "Meta Platforms", tier: 1 },
  { ticker: "AMZN", name: "Amazon", tier: 1 },
  { ticker: "ORCL", name: "Oracle", tier: 2 },
  { ticker: "CRWV", name: "CoreWeave", tier: 3 },
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

// Pulls and aligns cash flow + income statement quarters by fiscalDateEnding.
// Returns most-recent-first, up to numQuarters. Null if either statement is
// unavailable (missing key, rate-limited, or errored) — the caller treats
// this ticker as having no data rather than failing the whole screen.
async function getQuarterlyMetrics(ticker: string, notes: string[], numQuarters = 8): Promise<QuarterMetrics[] | null> {
  const [cf, inc] = await Promise.all([
    fetchStatement("CASH_FLOW", ticker, notes),
    fetchStatement("INCOME_STATEMENT", ticker, notes),
  ]);
  if (!cf || !inc) return null;

  const incByDate = new Map(inc.map((q) => [q.fiscalDateEnding, q]));

  return cf.slice(0, numQuarters).map((q) => {
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
  });
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
  tier: 1 | 2 | 3;
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
// endpoint and cache duration as getQuarterlyMetrics above.
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

export async function getAiEarningsData(expiration?: string): Promise<AiEarningsData> {
  const notes: string[] = [];
  const perTicker = await Promise.all(
    AI_EARNINGS_UNIVERSE.map(async (t) => {
      const quarters = await getQuarterlyMetrics(t.ticker, notes);
      return { meta: t, quarters };
    })
  );

  const raw: (Omit<AiEarningsScore, "fragilityScore"> & { fragilityScore: null })[] = [];
  for (const { meta, quarters } of perTicker) {
    if (!quarters || quarters.length === 0) continue;
    const latest = quarters[0];
    raw.push({
      ticker: meta.ticker,
      name: meta.name,
      tier: meta.tier,
      latestQuarter: latest.fiscalDateEnding,
      capexCoverageRatio: capexCoverageRatio(latest),
      capexToRevenue: trailingAverage(quarters, capexToRevenue),
      financingDependency: trailingAverage(quarters, financingDependency),
      coverageTrend: coverageTrend(quarters),
      buybackDeltaYoy: buybackDeltaYoy(quarters),
      interestExpenseYoyGrowth: interestExpenseYoyGrowth(quarters),
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
    `[ai-earnings] ${scores.length}/${AI_EARNINGS_UNIVERSE.length} tickers returned usable fundamentals data.`
  );

  let optionsRichness: OptionsRichness[] | undefined;
  if (expiration) {
    optionsRichness = await Promise.all(
      AI_EARNINGS_UNIVERSE.map((t) => getOptionsRichness(t.ticker, expiration))
    );
    const withStraddle = optionsRichness.filter((r) => r.straddle?.straddlePrice != null).length;
    console.error(
      `[ai-earnings] options richness for ${expiration}: ${withStraddle}/${AI_EARNINGS_UNIVERSE.length} tickers returned a straddle price.`
    );
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    scores,
    tickersWithData: scores.length,
    tickersRequested: AI_EARNINGS_UNIVERSE.length,
    ...(optionsRichness ? { optionsRichness } : {}),
    ...(notes.length > 0 ? { diagnostics: notes } : {}),
  };
}
