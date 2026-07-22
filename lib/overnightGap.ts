// Server-side data + logic for the "Overnight Gap" view (close-to-open
// delta), inside the Intraday Daypart module. Reuses the same daily-bar
// convention already validated for Catalyst Tracker's reaction calc, plus
// the same macro calendar and top-10 ticker list — see lib/catalysts.ts.
//
// Definition: for trading day D, overnight gap % = (Open[D] - Close[D-1]) /
// Close[D-1], where Close[D-1] is the prior trading day's 4:00 PM ET
// regular-session close and Open[D] is day D's 9:30 AM ET regular-session
// open. Confirmed live against Massive's dedicated Daily Open/Close
// endpoint (which separately labels preMarket/afterHours) that the daily
// Custom Bars aggregate's own `o`/`c` fields already are these exact
// regular-session prices — no separate endpoint needed here.
//
// This file must only ever be imported from server code: it reads equity
// data through lib/massive.ts (secret MASSIVE_API_KEY) and, for earnings
// tags, reads the secret FINNHUB_API_KEY directly.

import { getCustomBars } from "./massive";
import { TOP_10, MACRO_EVENTS } from "./catalysts";

// QQQ/TQQQ plus the same top-10 equities used elsewhere in the app.
const GAP_TICKERS: { ticker: string; name: string }[] = [
  { ticker: "QQQ", name: "Invesco QQQ Trust" },
  { ticker: "TQQQ", name: "ProShares UltraPro QQQ" },
  ...TOP_10,
];

interface FinnhubEarningsEntry {
  date?: string;
  symbol?: string;
  hour?: string; // "bmo" | "amc" | "dmh" | ""
}

interface FinnhubEarningsCalendarResponse {
  earningsCalendar?: FinnhubEarningsEntry[];
}

interface HistoricalEarningsResult {
  byTickerDate: Map<string, Map<string, string>>; // ticker -> date -> hour ("bmo"/"amc"/"dmh"/"")
  earliestDateInResponse: string | null; // earliest date Finnhub returned across ALL tickers, not just tracked ones — used to disclose the free-tier's actual historical depth rather than assuming one
}

/**
 * Historical counterpart to getUpcomingEarningsMap in lib/catalysts.ts —
 * same Finnhub free-tier endpoint, but for a past date range, and keeping
 * every date per ticker (not just the earliest) along with the `hour`
 * field, since that's what determines whether a given earnings report
 * actually drove an overnight gap (AMC the day before, or BMO the day of)
 * versus one released during market hours (`dmh`) or with unknown timing,
 * neither of which this feature tags.
 *
 * Verified live: Finnhub's free tier does return real historical earnings
 * (populated epsActual/hour) for a requested past range, but silently
 * truncates how far back it actually goes rather than erroring — observed
 * to be roughly the trailing month, not the full multi-month range some
 * callers might request. earliestDateInResponse surfaces the real cutoff
 * so the UI can disclose it accurately instead of assuming a fixed window.
 */
async function getHistoricalEarningsMap(tickers: string[], from: string, to: string): Promise<HistoricalEarningsResult> {
  const empty: HistoricalEarningsResult = { byTickerDate: new Map(), earliestDateInResponse: null };
  const rawKey = process.env.FINNHUB_API_KEY;
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    console.error("[overnight-gap] FINNHUB_API_KEY is not set — skipping earnings tags.");
    return empty;
  }

  try {
    const url = new URL("https://finnhub.io/api/v1/calendar/earnings");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("token", apiKey);
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[overnight-gap] Finnhub historical earnings request failed: ${res.status} ${body.slice(0, 300)}`);
      return empty;
    }

    const data = (await res.json()) as FinnhubEarningsCalendarResponse;
    const wanted = new Set(tickers);
    const byTickerDate = new Map<string, Map<string, string>>();
    let earliestDateInResponse: string | null = null;

    for (const entry of data.earningsCalendar ?? []) {
      if (entry.date && (!earliestDateInResponse || entry.date < earliestDateInResponse)) {
        earliestDateInResponse = entry.date;
      }
      if (!entry.symbol || !entry.date || !wanted.has(entry.symbol)) continue;
      if (!byTickerDate.has(entry.symbol)) byTickerDate.set(entry.symbol, new Map());
      byTickerDate.get(entry.symbol)!.set(entry.date, (entry.hour ?? "").trim().toLowerCase());
    }

    console.error(
      `[overnight-gap] Finnhub earnings tags: ${byTickerDate.size}/${tickers.length} tracked tickers matched; earliest date in response: ${earliestDateInResponse ?? "none"}.`
    );
    return { byTickerDate, earliestDateInResponse };
  } catch (err) {
    console.error(`[overnight-gap] Finnhub historical earnings lookup threw: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}

export type GapCatalystType = "Earnings" | "CPI" | "FOMC" | "NFP";

export interface GapCatalystTag {
  type: GapCatalystType;
  label: string;
}

export interface OvernightGap {
  ticker: string;
  date: string; // day D — the day the gap resolves into (Open[D] vs Close[D-1])
  weekday: string; // "Monday".."Friday", based on day D
  gapPct: number;
  tags: GapCatalystTag[];
  flagged: boolean; // true if D-1 -> D spans an unusually long calendar gap (possible halt/extended closure), not a normal weekend/holiday
}

export interface OvernightGapData {
  asOf: string;
  from: string;
  to: string;
  tickers: string[]; // GAP_TICKERS, for the UI's ticker filter
  gaps: OvernightGap[];
  earningsCoverageFrom: string | null; // actual earliest date Finnhub returned data for, or null if earnings tagging is unavailable
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(dateStr: string): string {
  return WEEKDAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Longest normal weekend+holiday cluster on the US equity calendar is a
// few calendar days (e.g. a Friday close into a Tuesday open after a
// Monday holiday). A wider span between two consecutive bars suggests a
// real trading halt or data gap rather than an ordinary non-trading day,
// so it gets flagged rather than silently treated like a routine gap.
const MAX_ROUTINE_GAP_DAYS = 5;

export async function getOvernightGapData(from: string, to: string): Promise<OvernightGapData> {
  const tickers = GAP_TICKERS.map((t) => t.ticker);
  const equityTickers = TOP_10.map((c) => c.ticker); // QQQ/TQQQ never report earnings

  const [barsByTicker, earningsResult] = await Promise.all([
    Promise.all(GAP_TICKERS.map((t) => getCustomBars(t.ticker, { multiplier: 1, timespan: "day", from, to }))),
    getHistoricalEarningsMap(equityTickers, from, to),
  ]);

  const gaps: OvernightGap[] = [];

  GAP_TICKERS.forEach((t, i) => {
    const bars = barsByTicker[i];
    const earningsForTicker = earningsResult.byTickerDate.get(t.ticker);

    for (let idx = 1; idx < bars.length; idx++) {
      const prev = bars[idx - 1];
      const curr = bars[idx];
      if (!(prev.c > 0) || !(curr.o > 0)) continue; // guard against bad/missing prints rather than dividing by a bad Close[D-1]

      const dDate = toDateStr(new Date(curr.t));
      const prevDate = toDateStr(new Date(prev.t));
      const calendarDays = Math.round(
        (new Date(`${dDate}T00:00:00Z`).getTime() - new Date(`${prevDate}T00:00:00Z`).getTime()) / 86_400_000
      );

      const tags: GapCatalystTag[] = [];
      const macroEvent = MACRO_EVENTS.find((e) => e.date === dDate);
      if (macroEvent && macroEvent.type !== "Earnings") {
        tags.push({ type: macroEvent.type, label: macroEvent.label });
      }

      if (earningsForTicker) {
        const prevHour = earningsForTicker.get(prevDate);
        const currHour = earningsForTicker.get(dDate);
        // AMC-the-day-before or BMO-the-day-of are the two cases that
        // cleanly explain THIS specific overnight gap, so they get a
        // precise label. Every other known earnings date for a tracked
        // ticker — "dmh" (during market hours), or timing Finnhub didn't
        // list — still gets surfaced as a catalyst (on the report day
        // itself) rather than silently dropped, since the report is real
        // even if it doesn't map cleanly to this one close-to-open window.
        if (prevHour === "amc") {
          tags.push({ type: "Earnings", label: `${t.ticker} Earnings (AMC ${prevDate})` });
        } else if (currHour === "bmo") {
          tags.push({ type: "Earnings", label: `${t.ticker} Earnings (BMO ${dDate})` });
        } else if (currHour !== undefined) {
          const timingNote = currHour === "dmh" ? "during market hours" : "timing unlisted";
          tags.push({ type: "Earnings", label: `${t.ticker} Earnings (${dDate}, ${timingNote})` });
        }
      }

      gaps.push({
        ticker: t.ticker,
        date: dDate,
        weekday: weekdayOf(dDate),
        gapPct: ((curr.o - prev.c) / prev.c) * 100,
        tags,
        flagged: calendarDays > MAX_ROUTINE_GAP_DAYS,
      });
    }
  });

  const earningsTagCount = gaps.filter((g) => g.tags.some((t) => t.type === "Earnings")).length;
  console.error(
    `[overnight-gap] ${gaps.length} total gap rows computed; ${earningsTagCount} carry an Earnings tag; Finnhub earnings map covers ${earningsResult.byTickerDate.size} tickers with data.`
  );

  return {
    asOf: toDateStr(new Date()),
    from,
    to,
    tickers,
    gaps,
    earningsCoverageFrom: earningsResult.earliestDateInResponse,
  };
}
