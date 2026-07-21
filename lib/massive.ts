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

async function fetchJson<T>(url: URL): Promise<T> {
  url.searchParams.set("apiKey", getApiKey());

  const res = await fetch(url.toString(), {
    // Cache for 60s on the server so we don't hammer the API on every page load.
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Massive API error ${res.status} for ${url.pathname}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

async function massiveFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetchJson<T>(url);
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
  next_url?: string;
}

const MAX_PAGES = 20;

/**
 * Custom Bars (Aggregates) endpoint.
 * GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
 *
 * Massive paginates results via `next_url` regardless of the requested
 * `limit` (observed: a single trading day of 15-minute bars can come back
 * split across several pages, starting with pre-market). This follows
 * next_url until exhausted so intraday callers actually get the full day
 * rather than silently only seeing whatever the first page happened to be.
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
  const { multiplier = 1, timespan = "day", from, to, limit = 50000 } = opts;
  const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}`;

  let data = await massiveFetch<CustomBarsResponse>(path, {
    adjusted: "true",
    sort: "asc",
    limit: String(limit),
  });

  const results = [...(data.results ?? [])];

  let pages = 0;
  while (data.next_url && pages < MAX_PAGES) {
    data = await fetchJson<CustomBarsResponse>(new URL(data.next_url));
    results.push(...(data.results ?? []));
    pages += 1;
  }

  return results;
}

const ET_TIME_ZONE = "America/New_York";

const TRADING_MINUTES_PER_DAY = 390; // 9:30-4:00 ET
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Parkinson (1980) range-based volatility estimator for a single bar,
 * annualized to a percentage comparable in scale to VIX. Uses only the
 * bar's own high/low, so it's computed from data the app already fetches
 * for QQQ's own Custom Bars — no Indices-tier subscription required (unlike
 * VIX, which is billed as a separate Massive/Polygon product line).
 *
 * This is *realized* volatility (backward-looking, derived from price
 * ranges), not *implied* volatility (forward-looking, derived from option
 * prices) — a different concept that serves a similar "how volatile right
 * now" purpose without requiring options-chain or index data.
 */
function parkinsonVolatilityPct(bar: CustomBar, bucketMinutes: number): number | null {
  if (!(bar.h > 0) || !(bar.l > 0) || bar.h < bar.l) return null;
  const logRange = Math.log(bar.h / bar.l);
  const variance = (1 / (4 * Math.LN2)) * logRange * logRange;
  const barsPerDay = TRADING_MINUTES_PER_DAY / bucketMinutes;
  const barsPerYear = barsPerDay * TRADING_DAYS_PER_YEAR;
  return Math.sqrt(variance * barsPerYear) * 100;
}

function etDateAndTime(epochMs: number): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function generateBucketTimes(startTime: string, endTime: string, stepMinutes: number): string[] {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  const times: string[] = [];
  for (let minutes = startTotal; minutes < endTotal; minutes += stepMinutes) {
    const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
    const minute = (minutes % 60).toString().padStart(2, "0");
    times.push(`${hour}:${minute}`);
  }
  return times;
}

export interface DaypartBucket {
  time: string; // "09:30", Eastern Time
  qqqVolume: number | null;
  tqqqVolume: number | null;
  volatilityPct: number | null; // annualized realized-vol proxy, from QQQ's own bar range
}

export interface DaypartData {
  date: string;
  startTime: string;
  endTime: string;
  buckets: DaypartBucket[];
}

/**
 * Intraday daypart breakdown (default 9:30 AM - 4:00 PM ET) in 15-minute
 * buckets: QQQ/TQQQ volume from Custom Bars, plus a realized-volatility
 * proxy (Parkinson estimator) derived from QQQ's own bar ranges. See
 * parkinsonVolatilityPct() for why this replaces VIX as the volatility
 * signal here.
 */
export async function getDaypartData(
  date: string,
  startTime = "09:30",
  endTime = "16:00",
  bucketMinutes = 15
): Promise<DaypartData> {
  const [qqqBars, tqqqBars] = await Promise.all([
    getCustomBars("QQQ", { multiplier: bucketMinutes, timespan: "minute", from: date, to: date }),
    getCustomBars("TQQQ", { multiplier: bucketMinutes, timespan: "minute", from: date, to: date }),
  ]);

  const toEtTimeMap = (bars: CustomBar[]) => {
    const map = new Map<string, CustomBar>();
    for (const bar of bars) {
      const { date: barDate, time } = etDateAndTime(bar.t);
      if (barDate === date) map.set(time, bar);
    }
    return map;
  };

  const qqqByTime = toEtTimeMap(qqqBars);
  const tqqqByTime = toEtTimeMap(tqqqBars);

  const buckets: DaypartBucket[] = generateBucketTimes(startTime, endTime, bucketMinutes).map((time) => {
    const qqqBar = qqqByTime.get(time);
    return {
      time,
      qqqVolume: qqqBar?.v ?? null,
      tqqqVolume: tqqqByTime.get(time)?.v ?? null,
      volatilityPct: qqqBar ? parkinsonVolatilityPct(qqqBar, bucketMinutes) : null,
    };
  });

  return { date, startTime, endTime, buckets };
}
