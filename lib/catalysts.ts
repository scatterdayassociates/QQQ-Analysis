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
//     scheduled earnings date, pulled live from Yahoo Finance's public
//     quoteSummary endpoint (see getNextEarningsDateYahoo below) — that's
//     a real-time lookup, not a hardcoded guess, so it doesn't carry the
//     same staleness risk. (Massive's own Benzinga earnings partnership
//     endpoint was tried first but returned NOT_AUTHORIZED on the current
//     plan — see git history for that attempt.)
//
// This file must only ever be imported from server code, since it reads
// equity data through lib/massive.ts (which reads the secret
// MASSIVE_API_KEY).

import { getCustomBars, getTickerMarketCap } from "./massive";

interface YahooCalendarEventsResponse {
  quoteSummary?: {
    result?: Array<{
      calendarEvents?: {
        earnings?: {
          earningsDate?: Array<{ raw?: number }>;
        };
      };
    }>;
  };
}

/**
 * Yahoo Finance's public quoteSummary endpoint — the same undocumented API
 * the `yfinance` Python package wraps. Free, no signup, no API key. Unlike
 * Massive's Benzinga earnings endpoint (rejected as NOT_AUTHORIZED on this
 * account's plan), Yahoo's endpoint doesn't require any subscription — but
 * it's unofficial and can change, add rate limits, or start requiring an
 * auth "crumb" without notice, so failures here are treated as "no
 * earnings date available" rather than fatal, same as getTickerMarketCap.
 */
async function getNextEarningsDateYahoo(ticker: string): Promise<string | null> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`);
    url.searchParams.set("modules", "calendarEvents");
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooCalendarEventsResponse;
    const dates = data.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? [];
    const withRaw = dates.find((d) => typeof d.raw === "number");
    if (!withRaw || typeof withRaw.raw !== "number") return null;
    return new Date(withRaw.raw * 1000).toISOString().slice(0, 10);
  } catch {
    return null;
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

  const [barsByTicker, marketCaps, nextEarningsByTicker] = await Promise.all([
    Promise.all(
      TOP_10.map((c) => getCustomBars(c.ticker, { multiplier: 1, timespan: "day", from: toDateStr(from), to: todayStr }))
    ),
    Promise.all(TOP_10.map((c) => getTickerMarketCap(c.ticker))),
    Promise.all(TOP_10.map((c) => getNextEarningsDateYahoo(c.ticker))),
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
  TOP_10.forEach((c, i) => {
    const date = nextEarningsByTicker[i];
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
