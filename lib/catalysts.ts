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
//   - Historical reactions cover macro events only (FOMC, CPI, Jobs
//     Report) — there's no verified historical-earnings-date source wired
//     up, and hardcoding past earnings dates without a reliable feed risks
//     the stale/wrong-date problem this rebuild has otherwise avoided.
//     Upcoming Catalysts, however, does include each top-10 ticker's next
//     scheduled earnings date, pulled live from Finnhub's free-tier
//     Earnings Calendar endpoint (see getUpcomingEarningsMap below) — a
//     real-time lookup, not a hardcoded guess, so it doesn't carry the
//     same staleness risk. Two earlier free options were tried and
//     rejected first: Massive's own Benzinga earnings endpoint
//     (NOT_AUTHORIZED on this account's plan) and Yahoo Finance's public
//     quoteSummary endpoint (now requires a session cookie + "crumb" token
//     Yahoo issues to block automated access) — see git history.
//
// This file must only ever be imported from server code: it reads equity
// data through lib/massive.ts (secret MASSIVE_API_KEY) and, for earnings,
// reads the secret FINNHUB_API_KEY directly.

import { getCustomBars, getTickerMarketCap } from "./massive";

interface FinnhubEarningsEntry {
  date?: string;
  symbol?: string;
}

interface FinnhubEarningsCalendarResponse {
  earningsCalendar?: FinnhubEarningsEntry[];
}

/**
 * Finnhub's free-tier Earnings Calendar endpoint
 * (https://finnhub.io/docs/api/earnings-calendar) — officially documented
 * and intended for exactly this use case, unlike the Yahoo/Benzinga
 * attempts before it. Requires a free API key (finnhub.io signup) set as
 * FINNHUB_API_KEY. Fetched once for the whole date range (the endpoint
 * returns all companies reporting in that window, not just one ticker),
 * then filtered down to the top-10 tickers here — cheaper than a
 * per-ticker call and avoids depending on the endpoint's optional (and
 * unverified) `symbol` filter parameter.
 *
 * Returns a ticker -> earliest upcoming earnings date map. Missing key or
 * any fetch failure degrades to an empty map rather than a fatal error,
 * same as the other optional lookups in this file — earnings rows just
 * won't appear in Upcoming Catalysts.
 */
async function getUpcomingEarningsMap(tickers: string[], from: string, to: string): Promise<Map<string, string>> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return new Map();

  try {
    const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("token", apiKey);
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return new Map();

    const data = (await res.json()) as FinnhubEarningsCalendarResponse;
    const wanted = new Set(tickers);
    const earliestByTicker = new Map<string, string>();
    for (const entry of data.earningsCalendar ?? []) {
      if (!entry.symbol || !entry.date || !wanted.has(entry.symbol)) continue;
      const existing = earliestByTicker.get(entry.symbol);
      if (!existing || entry.date < existing) earliestByTicker.set(entry.symbol, entry.date);
    }
    return earliestByTicker;
  } catch {
    return new Map();
  }
}

// Top 10 Nasdaq-100 (QQQ) holdings by weight, as of mid-2026. Weights drift
// with price and the index rebalances quarterly, so re-verify this list
// periodically rather than treating it as permanent.
const TOP_10: { ticker: string; name: string }[] = [
  { ticker: "NVDA", name: "NVIDIA Corporation" },
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "MSFT", name: "Microsoft Corporation" },
  { ticker: "AMZN", name: "Amazon.com, Inc." },
  { ticker: "GOOGL", name: "Alphabet Inc. (Class A)" },
  { ticker: "AVGO", name: "Broadcom Inc." },
  { ticker: "META", name: "Meta Platforms, Inc." },
  { ticker: "TSLA", name: "Tesla, Inc." },
  { ticker: "COST", name: "Costco Wholesale Corporation" },
  { ticker: "NFLX", name: "Netflix, Inc." },
];

type EventType = "FOMC" | "CPI" | "NFP" | "Earnings";

interface MacroEvent {
  date: string; // YYYY-MM-DD
  type: EventType;
  label: string;
}

// Sourced from federalreserve.gov (FOMC) and bls.gov release schedules
// (CPI, Employment Situation). FOMC dates are the announcement day (2nd
// day of the 2-day meeting); CPI/NFP dates are each release's actual
// publication day, not the reference month.
const MACRO_EVENTS: MacroEvent[] = [
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

  const [barsByTicker, marketCaps, upcomingEarningsByTicker] = await Promise.all([
    Promise.all(
      TOP_10.map((c) => getCustomBars(c.ticker, { multiplier: 1, timespan: "day", from: toDateStr(from), to: todayStr }))
    ),
    Promise.all(TOP_10.map((c) => getTickerMarketCap(c.ticker))),
    getUpcomingEarningsMap(tickers, todayStr, earningsWindowEndStr),
  ]);

  const components: CatalystComponent[] = TOP_10.map((c, i) => {
    const bars = barsByTicker[i];
    const latest = bars[bars.length - 1];
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
    const changePct = latest && prev ? ((latest.c - prev.c) / prev.c) * 100 : null;
    return {
      ticker: c.ticker,
      name: c.name,
      price: latest?.c ?? null,
      changePct,
      volume: latest?.v ?? null,
      marketCap: marketCaps[i],
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
  reactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayMidnightUtc = new Date(`${todayStr}T00:00:00Z`).getTime();
  const daysUntil = (date: string) => Math.round((new Date(`${date}T00:00:00Z`).getTime() - todayMidnightUtc) / oneDayMs);

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
