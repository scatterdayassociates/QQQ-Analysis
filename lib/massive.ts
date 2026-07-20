// Server-side client for the Massive (formerly Polygon.io) market data API.
// Docs: https://massive.com/docs/rest/stocks/overview
// This file must only ever be imported from server code (API routes),
// since it reads the secret MASSIVE_API_KEY.

const BASE_URL = process.env.MASSIVE_API_BASE_URL || "https://api.massive.com";

function getApiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) {
    throw new Error(
      "MASSIVE_API_KEY is not set. Add it to .env.local (locally) or your Vercel project's Environment Variables."
    );
  }
  return key;
}

async function massiveFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apiKey", getApiKey());

  const res = await fetch(url.toString(), {
    // Cache for 60s on the server so we don't hammer the API on every page load.
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Massive API error ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

export interface CustomBar {
  t: number; // epoch ms, start of bar
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  vw?: number; // volume-weighted average price
  n?: number; // number of transactions
}

interface CustomBarsResponse {
  ticker: string;
  status: string;
  results?: CustomBar[];
  resultsCount?: number;
}

/**
 * Custom Bars (Aggregates) endpoint.
 * GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
 */
export async function getCustomBars(
  ticker: string,
  opts: {
    multiplier?: number;
    timespan?: "minute" | "hour" | "day" | "week";
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
    limit?: number;
  }
): Promise<CustomBar[]> {
  const { multiplier = 1, timespan = "day", from, to, limit = 120 } = opts;
  const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}`;
  const data = await massiveFetch<CustomBarsResponse>(path, {
    adjusted: "true",
    sort: "asc",
    limit: String(limit),
  });
  return data.results ?? [];
}

export interface DailyTickerSummary {
  status: string;
  from: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  afterHours?: number;
  preMarket?: number;
}

/**
 * Daily Ticker Summary (Open/Close) endpoint.
 * GET /v1/open-close/{ticker}/{date}
 */
export async function getDailyTickerSummary(
  ticker: string,
  date: string // YYYY-MM-DD
): Promise<DailyTickerSummary | null> {
  try {
    return await massiveFetch<DailyTickerSummary>(
      `/v1/open-close/${encodeURIComponent(ticker)}/${date}`,
      { adjusted: "true" }
    );
  } catch {
    // Market holiday / no data for that date — treat as unavailable rather than fatal.
    return null;
  }
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface TickerDashboardData {
  ticker: string;
  bars: CustomBar[];
  latest: DailyTickerSummary | null;
  dayOverDayChangePct: number | null;
  dayOverLastWeekChangePct: number | null;
}

/**
 * Combines Custom Bars (for the volume history and to locate real trading
 * days) with the Daily Ticker Summary endpoint (for authoritative close
 * prices) to build everything the dashboard needs for one ticker.
 */
export async function getTickerDashboardData(ticker: string): Promise<TickerDashboardData> {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30); // wide enough window to cover holidays/weekends

  const bars = await getCustomBars(ticker, {
    multiplier: 1,
    timespan: "day",
    from: toDateStr(from),
    to: toDateStr(today),
  });

  if (bars.length === 0) {
    return { ticker, bars: [], latest: null, dayOverDayChangePct: null, dayOverLastWeekChangePct: null };
  }

  // Trading-day indices, based on real bars returned by Custom Bars (so
  // weekends/holidays are already excluded).
  const latestBar = bars[bars.length - 1];
  const prevDayBar = bars.length >= 2 ? bars[bars.length - 2] : null;
  const lastWeekBar = bars.length >= 6 ? bars[bars.length - 6] : null; // 5 trading days back

  const dateOf = (bar: CustomBar) => toDateStr(new Date(bar.t));

  const [latest, prevDay, lastWeek] = await Promise.all([
    getDailyTickerSummary(ticker, dateOf(latestBar)),
    prevDayBar ? getDailyTickerSummary(ticker, dateOf(prevDayBar)) : Promise.resolve(null),
    lastWeekBar ? getDailyTickerSummary(ticker, dateOf(lastWeekBar)) : Promise.resolve(null),
  ]);

  const pctChange = (from_: number | undefined, to_: number | undefined) =>
    from_ && to_ ? ((to_ - from_) / from_) * 100 : null;

  return {
    ticker,
    bars,
    latest,
    dayOverDayChangePct: pctChange(prevDay?.close, latest?.close),
    dayOverLastWeekChangePct: pctChange(lastWeek?.close, latest?.close),
  };
}
