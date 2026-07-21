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

const ET_TIME_ZONE = "America/New_York";

// VIX is a market-wide index, not a per-contract value, so the same ticker
// prefix convention as the rest of the Massive/Polygon API applies: index
// tickers are prefixed with "I:".
const VIX_TICKER = "I:VIX";

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
  vix: number | null;
}

export interface DaypartData {
  date: string;
  startTime: string;
  endTime: string;
  buckets: DaypartBucket[];
}

/**
 * Intraday daypart breakdown (default 9:30 AM - 4:00 PM ET) in 15-minute
 * buckets, combining QQQ/TQQQ volume from Custom Bars with the VIX index
 * close as a market-wide implied-volatility proxy (IV itself is a property
 * of individual option contracts, not the underlying ticker, so there is no
 * single "QQQ IV" or "TQQQ IV" value to plot directly).
 */
export async function getDaypartData(
  date: string,
  startTime = "09:30",
  endTime = "16:00",
  bucketMinutes = 15
): Promise<DaypartData> {
  const [qqqBars, tqqqBars, vixBars] = await Promise.all([
    getCustomBars("QQQ", { multiplier: bucketMinutes, timespan: "minute", from: date, to: date, limit: 200 }),
    getCustomBars("TQQQ", { multiplier: bucketMinutes, timespan: "minute", from: date, to: date, limit: 200 }),
    getCustomBars(VIX_TICKER, { multiplier: bucketMinutes, timespan: "minute", from: date, to: date, limit: 200 }),
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
  const vixByTime = toEtTimeMap(vixBars);

  const buckets: DaypartBucket[] = generateBucketTimes(startTime, endTime, bucketMinutes).map((time) => ({
    time,
    qqqVolume: qqqByTime.get(time)?.v ?? null,
    tqqqVolume: tqqqByTime.get(time)?.v ?? null,
    vix: vixByTime.get(time)?.c ?? null,
  }));

  return { date, startTime, endTime, buckets };
}
