// Server-side data + logic for the Catalyst Tracker tab. Replicates the
// intent of the source "Catalyst100" app (top-10 Nasdaq-100 components,
// historical 1-day reactions to macro catalysts, and an upcoming-catalyst
// calendar), rebuilt against Massive (for prices/volume) plus a hardcoded,
// source-verified macro calendar (no live calendar API in the current plan).
//
// Scope decisions versus the source app, both disclosed in the UI:
//   - The top-10 list is a fixed snapshot (ticker + name), not a live,
//     continuously-rebalanced weighting — QQQ/NDX weights drift with price
//     and quarterly rebalances, so treat the ranking as "as of" rather than
//     real-time.
//   - Historical reactions cover both macro events (FOMC, CPI, Jobs
//     Report) and each top-10 ticker's own historical earnings dates —
//     now with BMO/AMC timing awareness via Finnhub (see
//     getHistoricalEarningsWithTiming below). Before-open earnings
//     (BMO) are measured close(T) / close(T-1) on the report date;
//     after-close earnings (AMC) are measured close(T+1) / close(T)
//     on the next trading day. Unknown timing defaults to AMC
//     (conservative, captures full reaction window).
//   - Upcoming Catalysts includes each top-10 ticker's next scheduled
//     earnings date, pulled live from Alpha Vantage's free EARNINGS_CALENDAR
//     endpoint (see getUpcomingEarningsMap below) — a real-time lookup, not
//     a hardcoded guess.
//
// This file must only ever be imported from server code: it reads equity
// data through lib/massive.ts (secret MASSIVE_API_KEY) and, for upcoming
// earnings and historical earnings timing, reads the secret ALPHA_VANTAGE_API_KEY
// and FINNHUB_API_KEY directly.

import { getCustomBars, getTickerMarketCap } from "./massive";

// Retry helper with exponential backoff for flaky API calls
async function fetchWithRetry(
  url: string,
  maxRetries: number = 3,
  initialDelayMs: number = 500
): Promise<Response | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.error(`[catalysts] Fetch attempt ${attempt + 1}/${maxRetries}: calling ${url.split("?")[0]}`);
      const res = await fetch(url, { next: { revalidate: 3600 } });
      console.error(`[catalysts] Fetch attempt ${attempt + 1} got HTTP ${res.status}`);
      // Retry on transient errors: network timeouts, 429 (rate limit), 5xx server errors
      if (res.ok || res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) {
        // Success or permanent client error — don't retry
        return res;
      }
      if (res.status === 429 || res.status >= 500) {
        // Rate limited or server error — retry this
        lastError = new Error(`HTTP ${res.status}`);
        if (attempt < maxRetries - 1) {
          const delayMs = initialDelayMs * Math.pow(2, attempt);
          console.error(`[catalysts] HTTP ${res.status}, retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        return res;
      }
      return res;
    } catch (err) {
      // Network error (timeout, connection refused, etc.) — retry
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        console.error(
          `[catalysts] Fetch attempt ${attempt + 1}/${maxRetries} threw, retrying in ${delayMs}ms: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }
  }

  console.error(`[catalysts] Fetch failed after ${maxRetries} attempts: ${lastError?.message}`);
  return null;
}

// Minimal CSV row parser respecting quoted fields (Alpha Vantage quotes any
// company name containing a comma, e.g. "AutoNation, Inc."), since a naive
// split(",") would misalign columns for those rows.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

type EarningsHorizon = "3month" | "6month" | "12month";

/**
 * Alpha Vantage's free EARNINGS_CALENDAR endpoint
 * (https://www.alphavantage.co/documentation/#earnings-calendar) —
 * officially documented, free-tier accessible, and returns CSV (not JSON,
 * unlike most Alpha Vantage endpoints): symbol,name,reportDate,
 * fiscalDateEnding,estimate,currency. No `symbol` filter is passed here —
 * fetched once for the whole market (same cost either way on this
 * endpoint) and filtered down to the top-10 tickers below, same
 * single-call-then-filter pattern used elsewhere in this file.
 *
 * Note: this endpoint has no before-open/after-close ("hour") field and no
 * historical/past-date mode (`horizon` only accepts 3month/6month/12month
 * forward-looking windows) — fine for Upcoming Catalysts, which only needs
 * a date, but not usable for Overnight Gap's historical earnings tagging
 * (that stays on Finnhub, see lib/overnightGap.ts).
 *
 * Returns a ticker -> earliest upcoming earnings date map. Missing key or
 * any fetch failure degrades to an empty map rather than a fatal error,
 * same as the other optional lookups in this file — earnings rows just
 * won't appear in Upcoming Catalysts.
 */
async function getUpcomingEarningsMap(tickers: string[], horizon: EarningsHorizon = "3month"): Promise<Map<string, string>> {
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    console.error(
      `[catalysts] ALPHA_VANTAGE_API_KEY not configured. rawKey exists: ${!!rawKey}, length: ${rawKey?.length || 0}`
    );
    return new Map();
  }
  console.error(`[catalysts] Using ALPHA_VANTAGE_API_KEY (length: ${apiKey.length})`);


  try {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "EARNINGS_CALENDAR");
    url.searchParams.set("horizon", horizon);
    url.searchParams.set("apikey", apiKey);

    // Use retry helper for resilience against transient failures
    const res = await fetchWithRetry(url.toString(), 3, 500);
    if (!res) {
      console.error("[catalysts] Alpha Vantage earnings request failed after retries (network error)");
      return new Map();
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[catalysts] Alpha Vantage earnings request failed: ${res.status} ${body.slice(0, 300)}`);
      return new Map();
    }

    const csvText = await res.text();
    console.error(`[catalysts] Alpha Vantage raw response length: ${csvText.length}, first 200 chars: ${csvText.slice(0, 200)}`);

    // Alpha Vantage returns a 200 with a plain-text "Information"/rate-limit
    // notice (no CSV header) when a key is invalid or the daily quota is
    // exhausted — detect that rather than trying to parse it as CSV rows.
    if (!csvText.includes("symbol") || csvText.trim().startsWith("{")) {
      console.error(`[catalysts] Alpha Vantage returned a non-CSV response (likely rate-limited or bad key): ${csvText.slice(0, 300)}`);
      return new Map();
    }

    const lines = csvText.trim().split("\n");
    const wanted = new Set(tickers);
    const earliestByTicker = new Map<string, string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const symbol = cols[0]?.trim();
      const reportDate = cols[2]?.trim();
      if (!symbol || !reportDate || !wanted.has(symbol)) continue;
      const existing = earliestByTicker.get(symbol);
      if (!existing || reportDate < existing) earliestByTicker.set(symbol, reportDate);
    }
    console.error(
      `[catalysts] Alpha Vantage: ${lines.length - 1} rows parsed, ${earliestByTicker.size}/${tickers.length} matched tickers.`
    );
    return earliestByTicker;
  } catch (err) {
    console.error(`[catalysts] Alpha Vantage earnings lookup threw: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}

interface AlphaVantageQuarterlyEarning {
  fiscalDateEnding?: string;
  reportedDate?: string;
}

interface AlphaVantageEarningsResponse {
  symbol?: string;
  quarterlyEarnings?: AlphaVantageQuarterlyEarning[];
  Information?: string;
  Note?: string;
}

/**
 * Alpha Vantage's EARNINGS endpoint (function=EARNINGS&symbol=X) — a
 * different endpoint from EARNINGS_CALENDAR above, since only this one
 * carries genuine multi-year historical `reportedDate` values per quarter.
 * No bulk/all-companies mode though (unlike EARNINGS_CALENDAR) — one call
 * per ticker, so covering all 10 tracked tickers costs 10 requests, not 1.
 * Powers Historical 1-Day Reactions' Earnings rows, the same way
 * MACRO_EVENTS powers the FOMC/CPI/NFP rows below. No before-open/
 * after-close field here either, so reactions are computed close-to-close
 * over the report date itself — the same convention already used for
 * macro events, which also don't distinguish intraday timing.
 *
 * Cached for 6 hours (`revalidate: 21600`, longer than the 1-hour used
 * for the single-call endpoint above) since this spends a much larger
 * share of the free tier's daily quota per fetch; a failed or
 * rate-limited ticker just contributes no historical earnings reactions
 * rather than breaking the others.
 */
async function getHistoricalEarningsDatesByTicker(tickers: string[], from: string, to: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    console.error("[catalysts] ALPHA_VANTAGE_API_KEY is not set — skipping historical earnings reactions.");
    return result;
  }

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const url = new URL("https://www.alphavantage.co/query");
        url.searchParams.set("function", "EARNINGS");
        url.searchParams.set("symbol", ticker);
        url.searchParams.set("apikey", apiKey);
        const res = await fetch(url.toString(), { next: { revalidate: 21600 } });
        if (!res.ok) {
          console.error(`[catalysts] Alpha Vantage EARNINGS request failed for ${ticker}: ${res.status}`);
          return;
        }
        const data = (await res.json()) as AlphaVantageEarningsResponse;
        if (data.Information || data.Note) {
          console.error(
            `[catalysts] Alpha Vantage EARNINGS rate-limited/errored for ${ticker}: ${(data.Information || data.Note || "").slice(0, 200)}`
          );
          return;
        }
        const dates = (data.quarterlyEarnings ?? [])
          .map((q) => q.reportedDate)
          .filter((d): d is string => !!d && d >= from && d <= to);
        if (dates.length > 0) result.set(ticker, dates);
      } catch (err) {
        console.error(`[catalysts] Alpha Vantage EARNINGS lookup threw for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  const totalDates = [...result.values()].reduce((sum, d) => sum + d.length, 0);
  console.error(
    `[catalysts] Alpha Vantage historical earnings: ${result.size}/${tickers.length} tickers returned data, ${totalDates} report dates in range.`
  );
  return result;
}

interface FinnhubEarningsEntry {
  date?: string;
  symbol?: string;
  hour?: string; // "bmo" | "amc" | "dmh" | ""
}

interface FinnhubEarningsCalendarResponse {
  earningsCalendar?: FinnhubEarningsEntry[];
}

/**
 * Fetches historical earnings timing (BMO/AMC) from Finnhub for a date range.
 * Returns a map: ticker -> date -> hour ("bmo"/"amc"/"dmh"/"").
 * Free tier typically returns trailing month of data; earlier dates will be
 * empty/missing. Missing entries default to "amc" (after-close) for
 * conservative reaction window measurement.
 */
async function getHistoricalEarningsWithTiming(tickers: string[], from: string, to: string): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  const rawKey = process.env.FINNHUB_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    console.error("[catalysts] FINNHUB_API_KEY is not set — earnings timing unavailable, defaulting to AMC.");
    return result;
  }

  try {
    const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("token", apiKey);
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[catalysts] Finnhub historical earnings request failed: ${res.status} ${body.slice(0, 300)}`);
      return result;
    }

    const data = (await res.json()) as FinnhubEarningsCalendarResponse;
    const wanted = new Set(tickers);

    for (const entry of data.earningsCalendar ?? []) {
      if (!entry.symbol || !entry.date || !wanted.has(entry.symbol)) continue;
      if (!result.has(entry.symbol)) result.set(entry.symbol, new Map());
      result.get(entry.symbol)!.set(entry.date, (entry.hour ?? "").trim().toLowerCase());
    }

    console.error(
      `[catalysts] Finnhub earnings timing: ${result.size}/${tickers.length} tracked tickers have BMO/AMC data.`
    );
    return result;
  } catch (err) {
    console.error(`[catalysts] Finnhub historical earnings lookup threw: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
}

interface AlphaVantageOverviewResponse {
  EVToEBITDA?: string;
  Information?: string;
  Note?: string;
}

/**
 * Alpha Vantage's OVERVIEW endpoint (function=OVERVIEW&symbol=X) — the
 * source for EV/EBITDA, since neither Massive endpoint already used in this
 * file carries a valuation multiple. Like EARNINGS above, no bulk mode: one
 * request per ticker. EVToEBITDA comes back as the literal string "None"
 * when EBITDA is negative/unavailable — those show "—" in the UI rather
 * than a misleading number. Cached for 1 hour, same as the upcoming
 * earnings lookup above, since it's a valuation ratio rather than a
 * slow-moving fundamental. Previously this fetched PERatio (P/E) instead —
 * swapped for EV/EBITDA per request, since it's capital-structure-neutral
 * (accounts for debt/cash, unlike P/E) and comparable across companies with
 * different leverage — arguably the more useful cross-sectional valuation
 * metric for a top-10-by-weight comparison table like this one.
 */
async function getEvToEbitdaByTicker(tickers: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const rawKey = process.env.ALPHA_VANTAGE_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    console.error("[catalysts] ALPHA_VANTAGE_API_KEY is not set — skipping EV/EBITDA lookup.");
    return result;
  }

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const url = new URL("https://www.alphavantage.co/query");
        url.searchParams.set("function", "OVERVIEW");
        url.searchParams.set("symbol", ticker);
        url.searchParams.set("apikey", apiKey);
        const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
        if (!res.ok) {
          console.error(`[catalysts] Alpha Vantage OVERVIEW request failed for ${ticker}: ${res.status}`);
          return;
        }
        const data = (await res.json()) as AlphaVantageOverviewResponse;
        if (data.Information || data.Note) {
          console.error(
            `[catalysts] Alpha Vantage OVERVIEW rate-limited/errored for ${ticker}: ${(data.Information || data.Note || "").slice(0, 200)}`
          );
          return;
        }
        const evToEbitda = Number(data.EVToEBITDA);
        if (data.EVToEBITDA && data.EVToEBITDA !== "None" && Number.isFinite(evToEbitda)) result.set(ticker, evToEbitda);
      } catch (err) {
        console.error(`[catalysts] Alpha Vantage OVERVIEW lookup threw for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  console.error(`[catalysts] Alpha Vantage EV/EBITDA: ${result.size}/${tickers.length} tickers returned a value.`);
  return result;
}

// Top 10 Nasdaq-100 (QQQ) holdings by weight, as of mid-2026. Weights drift
// with price and the index rebalances quarterly, so re-verify this list
// periodically rather than treating it as permanent. Exported so the
// Overnight Gap feature (lib/overnightGap.ts) can reuse the same list
// instead of maintaining a second copy.
export const TOP_10: { ticker: string; name: string }[] = [
  { ticker: "NVDA", name: "NVIDIA Corporation" },
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "MSFT", name: "Microsoft Corporation" },
  { ticker: "AMZN", name: "Amazon.com, Inc." },
  { ticker: "GOOGL", name: "Alphabet Inc. (Class A)" },
  { ticker: "AVGO", name: "Broadcom Inc." },
  { ticker: "META", name: "Meta Platforms, Inc." },
  { ticker: "TSLA", name: "Tesla, Inc." },
  { ticker: "MU", name: "Micron Technology, Inc." },
  { ticker: "AMD", name: "Advanced Micro Devices, Inc." },
];

export type EventType = "FOMC" | "CPI" | "NFP" | "Earnings";

export interface MacroEvent {
  date: string; // YYYY-MM-DD
  type: EventType;
  label: string;
}

// Sourced from federalreserve.gov (FOMC) and bls.gov release schedules
// (CPI, Employment Situation). FOMC dates are the announcement day (2nd
// day of the 2-day meeting); CPI/NFP dates are each release's actual
// publication day, not the reference month. Exported for reuse by the
// Overnight Gap feature (lib/overnightGap.ts).
export const MACRO_EVENTS: MacroEvent[] = [
  { date: "2026-01-28", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-03-18", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-04-29", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-06-17", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-07-29", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-09-16", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-10-28", type: "FOMC", label: "FOMC Rate Decision" },
  { date: "2026-12-09", type: "FOMC", label: "FOMC Rate Decision" },

  { date: "2026-01-13", type: "CPI", label: "CPI Release (Dec 2025)" },
  { date: "2026-02-13", type: "CPI", label: "CPI Release (Jan 2026)" },
  { date: "2026-03-11", type: "CPI", label: "CPI Release (Feb 2026)" },
  { date: "2026-04-10", type: "CPI", label: "CPI Release (Mar 2026)" },
  { date: "2026-05-12", type: "CPI", label: "CPI Release (Apr 2026)" },
  { date: "2026-06-10", type: "CPI", label: "CPI Release (May 2026)" },
  { date: "2026-07-14", type: "CPI", label: "CPI Release (Jun 2026)" },
  { date: "2026-08-12", type: "CPI", label: "CPI Release (Jul 2026)" },

  { date: "2026-01-09", type: "NFP", label: "Jobs Report (Dec 2025)" },
  { date: "2026-02-11", type: "NFP", label: "Jobs Report (Jan 2026)" },
  { date: "2026-03-06", type: "NFP", label: "Jobs Report (Feb 2026)" },
  { date: "2026-04-03", type: "NFP", label: "Jobs Report (Mar 2026)" },
  { date: "2026-05-08", type: "NFP", label: "Jobs Report (Apr 2026)" },
  { date: "2026-06-05", type: "NFP", label: "Jobs Report (May 2026)" },
  { date: "2026-07-02", type: "NFP", label: "Jobs Report (Jun 2026)" },
  { date: "2026-08-07", type: "NFP", label: "Jobs Report (Jul 2026)" },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface CatalystComponent {
  ticker: string;
  name: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  evToEbitda: number | null; // enterprise value / EBITDA, null if negative EBITDA or unavailable
  daysUntilEarnings: number | null; // next scheduled earnings date minus today; null if unavailable
}

export interface CatalystReaction {
  ticker: string;
  eventType: EventType;
  eventLabel: string;
  date: string;
  reactionPct: number;
}

export interface UpcomingCatalyst {
  date: string;
  eventType: EventType;
  eventLabel: string;
  ticker: string | null; // set for Earnings rows, null for macro-wide events
  daysUntil: number;
}

export interface CatalystTrackerData {
  asOf: string;
  components: CatalystComponent[];
  reactions: CatalystReaction[];
  upcoming: UpcomingCatalyst[];
}

const EARNINGS_LOOKAHEAD_DAYS = 90; // covers the next quarterly reporting cycle for all 10 tickers

export async function getCatalystTrackerData(): Promise<CatalystTrackerData> {
  const today = new Date();
  const todayStr = toDateStr(today);
  const from = new Date(today);
  from.setDate(from.getDate() - 240); // comfortably covers Jan 2026 through today, plus a leading trading day
  const earningsWindowEnd = new Date(today);
  earningsWindowEnd.setDate(earningsWindowEnd.getDate() + EARNINGS_LOOKAHEAD_DAYS);
  const earningsWindowEndStr = toDateStr(earningsWindowEnd);

  const tickers = TOP_10.map((c) => c.ticker);

  const [barsByTicker, marketCaps, evToEbitdaByTicker, upcomingEarningsByTicker, historicalEarningsByTicker, earningsTimingByTicker] = await Promise.all([
    Promise.all(
      TOP_10.map((c) => getCustomBars(c.ticker, { multiplier: 1, timespan: "day", from: toDateStr(from), to: todayStr }))
    ),
    Promise.all(TOP_10.map((c) => getTickerMarketCap(c.ticker))),
    getEvToEbitdaByTicker(tickers),
    getUpcomingEarningsMap(tickers, "3month"),
    getHistoricalEarningsDatesByTicker(tickers, toDateStr(from), todayStr),
    getHistoricalEarningsWithTiming(tickers, toDateStr(from), todayStr),
  ]);

  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayMidnightUtc = new Date(`${todayStr}T00:00:00Z`).getTime();
  const daysUntil = (date: string) => Math.round((new Date(`${date}T00:00:00Z`).getTime() - todayMidnightUtc) / oneDayMs);

  const components: CatalystComponent[] = TOP_10.map((c, i) => {
    const bars = barsByTicker[i];
    const latest = bars[bars.length - 1];
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
    const changePct = latest && prev ? ((latest.c - prev.c) / prev.c) * 100 : null;
    const nextEarningsDate = upcomingEarningsByTicker.get(c.ticker);
    return {
      ticker: c.ticker,
      name: c.name,
      price: latest?.c ?? null,
      changePct,
      volume: latest?.v ?? null,
      marketCap: marketCaps[i],
      evToEbitda: evToEbitdaByTicker.get(c.ticker) ?? null,
      daysUntilEarnings: nextEarningsDate ? daysUntil(nextEarningsDate) : null,
    };
  });

  // date -> close, and a sorted date index, per ticker — used to look up
  // each event day's close plus the prior trading day's close for the
  // 1-day reaction calculation.
  const closesByTicker: Record<string, Map<string, number>> = {};
  const sortedDatesByTicker: Record<string, string[]> = {};
  TOP_10.forEach((c, i) => {
    const map = new Map<string, number>();
    for (const bar of barsByTicker[i]) map.set(toDateStr(new Date(bar.t)), bar.c);
    closesByTicker[c.ticker] = map;
    sortedDatesByTicker[c.ticker] = [...map.keys()].sort();
  });

  const reactions: CatalystReaction[] = [];
  for (const event of MACRO_EVENTS) {
    if (event.date > todayStr) continue; // future events are "upcoming", handled below
    for (const c of TOP_10) {
      const dates = sortedDatesByTicker[c.ticker];
      const idx = dates.indexOf(event.date);
      if (idx <= 0) continue; // no bar that day, or no prior trading day to compare against
      const eventClose = closesByTicker[c.ticker].get(dates[idx])!;
      const priorClose = closesByTicker[c.ticker].get(dates[idx - 1])!;
      reactions.push({
        ticker: c.ticker,
        eventType: event.type,
        eventLabel: event.label,
        date: event.date,
        reactionPct: ((eventClose - priorClose) / priorClose) * 100,
      });
    }
  }
  for (const c of TOP_10) {
    const earningsDates = historicalEarningsByTicker.get(c.ticker) ?? [];
    const dates = sortedDatesByTicker[c.ticker];
    const timingByDate = earningsTimingByTicker.get(c.ticker);
    const hasTimingData = timingByDate && timingByDate.size > 0; // true only if Finnhub fetch succeeded
    for (const eDate of earningsDates) {
      if (eDate > todayStr) continue; // future reports are "upcoming", handled above
      const idx = dates.indexOf(eDate);
      if (idx <= 0) continue; // no bar that day, or no prior trading day to compare against

      // Get earnings timing (BMO/AMC); only use if Finnhub data is available
      const hour = timingByDate?.get(eDate) ?? "";
      // Only treat as BMO if we have explicit Finnhub timing confirming it
      const isBmo = hasTimingData && hour.toLowerCase() === "bmo";

      let eventClose: number;
      let priorClose: number;

      if (isBmo) {
        // Before-market-open (explicit Finnhub data): measure close(T) vs close(T-1) on the earnings date
        eventClose = closesByTicker[c.ticker].get(dates[idx])!;
        priorClose = closesByTicker[c.ticker].get(dates[idx - 1])!;
      } else if (hasTimingData && hour.toLowerCase() === "amc") {
        // After-market-close (explicit Finnhub data): measure close(T+1) vs close(T) on next day
        if (idx >= dates.length - 1) continue; // no next trading day to compare against
        eventClose = closesByTicker[c.ticker].get(dates[idx + 1])!;
        priorClose = closesByTicker[c.ticker].get(dates[idx])!;
      } else {
        // No Finnhub timing data available (API key missing or feature disabled):
        // Fall back to original BMO logic — conservative assumption that most earnings are before/during market hours
        eventClose = closesByTicker[c.ticker].get(dates[idx])!;
        priorClose = closesByTicker[c.ticker].get(dates[idx - 1])!;
      }

      reactions.push({
        ticker: c.ticker,
        eventType: "Earnings",
        eventLabel: `${c.ticker} Earnings`,
        date: eDate,
        reactionPct: ((eventClose - priorClose) / priorClose) * 100,
      });
    }
  }

  reactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  const macroUpcoming: UpcomingCatalyst[] = MACRO_EVENTS.filter((e) => e.date > todayStr).map((e) => ({
    date: e.date,
    eventType: e.type,
    eventLabel: e.label,
    ticker: null,
    daysUntil: daysUntil(e.date),
  }));

  const earningsUpcoming: UpcomingCatalyst[] = [];
  TOP_10.forEach((c) => {
    const date = upcomingEarningsByTicker.get(c.ticker);
    if (date && date > todayStr && date <= earningsWindowEndStr) {
      earningsUpcoming.push({
        date,
        eventType: "Earnings",
        eventLabel: `${c.ticker} Earnings`,
        ticker: c.ticker,
        daysUntil: daysUntil(date),
      });
    }
  });

  const upcoming: UpcomingCatalyst[] = [...macroUpcoming, ...earningsUpcoming].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  return { asOf: todayStr, components, reactions, upcoming };
}
