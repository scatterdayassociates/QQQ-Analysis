"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalystTrackerData, CatalystReaction } from "@/lib/catalysts";

const EVENT_TYPES = ["FOMC", "CPI", "NFP", "Earnings"] as const;

function formatVolume(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
}

function formatMarketCap(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  return `$${(v / 1_000_000).toFixed(0)}M`;
}

function formatPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pctClass(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? "up" : "down";
}

function formatEvToEbitda(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}x`;
}

const EV_TO_EBITDA_TOOLTIP =
  "EV/EBITDA = Enterprise Value ÷ EBITDA (earnings before interest, taxes, depreciation & amortization). " +
  "Unlike P/E, it accounts for debt and cash on the balance sheet and ignores differences in depreciation/" +
  "capital structure across companies — a more comparable valuation multiple across the top-10 names here.";

function formatDaysUntilEarnings(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "Today";
  if (v === 1) return "1 day";
  return `${v} days`;
}

export default function CatalystPanel() {
  const [data, setData] = useState<CatalystTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const previousComponentsRef = useRef<CatalystTrackerData["components"] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/catalysts");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load catalyst tracker data");

      const newData = json as CatalystTrackerData;

      // If rate-limited and we have previous data, merge daysUntilEarnings from cache
      if (newData.rateLimitError && newData.isStaleCache && previousComponentsRef.current) {
        const mergedComponents = newData.components.map((component) => {
          const previousComponent = previousComponentsRef.current?.find((p) => p.ticker === component.ticker);
          return {
            ...component,
            // Preserve daysUntilEarnings from previous successful fetch if current is null
            daysUntilEarnings: component.daysUntilEarnings ?? previousComponent?.daysUntilEarnings ?? null,
          };
        });
        newData.components = mergedComponents;
      }

      // Store components for next refresh
      previousComponentsRef.current = newData.components;
      setData(newData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalyst tracker data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredReactions: CatalystReaction[] = useMemo(() => {
    let rows = data?.reactions ?? [];
    if (tickerFilter !== "all") rows = rows.filter((r) => r.ticker === tickerFilter);
    if (typeFilter !== "all") rows = rows.filter((r) => r.eventType === typeFilter);
    return rows;
  }, [data, tickerFilter, typeFilter]);

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Catalyst Tracker</h1>
          <p className="subtitle">
            The top 10 Nasdaq-100 components by weight, how they&apos;ve historically reacted to macro
            catalysts, and what&apos;s scheduled next.
          </p>
        </div>
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data?.rateLimitError && (
        <div className={`warning-box${data.isStaleCache ? " stale-cache" : ""}`}>
          <strong>{data.isStaleCache ? "⚠️ Cached Data:" : "⚠️ Rate Limited:"}</strong> {data.rateLimitError}
        </div>
      )}

      {data && !error && (
        <>
          <div className="card">
            <div className="chart-label">Top 10 NDX-100 Components</div>
            <div className="table-wrap">
              <table className="mono">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Change</th>
                    <th>Volume</th>
                    <th>Market Cap</th>
                    <th title={EV_TO_EBITDA_TOOLTIP}>EV/EBITDA</th>
                    <th>Days Till Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.components.map((c) => (
                    <tr key={c.ticker}>
                      <td>{c.ticker}</td>
                      <td>{c.name}</td>
                      <td>{c.price !== null ? `$${c.price.toFixed(2)}` : "—"}</td>
                      <td className={pctClass(c.changePct)}>{formatPct(c.changePct)}</td>
                      <td>{formatVolume(c.volume)}</td>
                      <td>{formatMarketCap(c.marketCap)}</td>
                      <td>{formatEvToEbitda(c.evToEbitda)}</td>
                      <td>{formatDaysUntilEarnings(c.daysUntilEarnings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="table-toolbar">
              <span className="chart-label">Historical 1-Day Reactions</span>
              <div className="catalyst-filters">
                <select value={tickerFilter} onChange={(e) => setTickerFilter(e.target.value)}>
                  <option value="all">All tickers</option>
                  {data.components.map((c) => (
                    <option key={c.ticker} value={c.ticker}>
                      {c.ticker}
                    </option>
                  ))}
                </select>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="all">All event types</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table className="mono">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ticker</th>
                    <th>Event</th>
                    <th>1-Day Reaction</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReactions.map((r, i) => (
                    <tr key={`${r.ticker}-${r.date}-${i}`}>
                      <td>{r.date}</td>
                      <td>{r.ticker}</td>
                      <td>
                        <span className={`event-chip event-${r.eventType.toLowerCase()}`}>{r.eventType}</span>{" "}
                        {r.eventLabel}
                      </td>
                      <td className={pctClass(r.reactionPct)}>{formatPct(r.reactionPct)}</td>
                    </tr>
                  ))}
                  {filteredReactions.length === 0 && (
                    <tr>
                      <td colSpan={4} className="skeleton">
                        No reactions match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="chart-label">Upcoming Catalysts</div>
            <div className="table-wrap">
              <table className="mono">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Event</th>
                    <th>Days Until</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((u) => (
                    <tr key={`${u.date}-${u.eventType}-${u.ticker ?? ""}`}>
                      <td>{u.date}</td>
                      <td>
                        <span className={`event-chip event-${u.eventType.toLowerCase()}`}>{u.eventType}</span>{" "}
                        {u.eventLabel}
                      </td>
                      <td>{u.daysUntil}</td>
                    </tr>
                  ))}
                  {data.upcoming.length === 0 && (
                    <tr>
                      <td colSpan={3} className="skeleton">
                        No upcoming catalysts in the current window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> The top-10 list (NVDA, AAPL, MSFT, AMZN, GOOGL, AVGO, META, TSLA,
        MU, AMD) reflects Nasdaq-100/QQQ weightings as of mid-2026 — it&apos;s a fixed snapshot, not a
        continuously-rebalanced live ranking, since weights drift with price and the index rebalances
        quarterly. Price, change, and volume come from Massive&apos;s Custom Bars endpoint; market cap
        comes from Massive&apos;s Ticker Details (reference) endpoint and shows “—” if unavailable on the
        current plan. <strong>EV/EBITDA</strong> (Enterprise Value ÷ EBITDA) comes from Alpha
        Vantage&apos;s <code>OVERVIEW</code> endpoint (one request per ticker, same key as the rest of
        this tab, replacing the P/E Ratio column previously here) and shows “—” when EBITDA is negative
        or unavailable. Unlike P/E, it factors in each company&apos;s debt and cash and isn&apos;t
        distorted by differences in depreciation or capital structure, making it a more
        apples-to-apples valuation multiple across these ten names — hover the column header for the
        same definition inline.{" "}
        <strong>Days Till Earnings</strong> is each ticker&apos;s next scheduled report
        date (from Alpha Vantage, same source as Upcoming Catalysts) minus today&apos;s date, and shows
        “—” if no report is scheduled within the lookahead window or Alpha Vantage isn&apos;t configured.
        The macro calendar (FOMC rate decisions, CPI releases, jobs reports) is compiled
        from the Federal Reserve&apos;s and BLS&apos;s published schedules — historical reactions to
        those are computed as the real close-to-close % move from the trading day before each event
        to the event day itself, covering Jan 2026–present. <strong>Earnings</strong> rows in
        Historical 1-Day Reactions use the same close-to-close calculation, applied to each top-10
        ticker&apos;s own historical report dates — pulled live from Alpha Vantage&apos;s
        <code>EARNINGS</code> endpoint (a different one from <code>EARNINGS_CALENDAR</code>, since
        only this one carries genuine multi-year historical dates; one request per ticker rather
        than a single market-wide call, so it uses more of the free tier&apos;s daily quota).
        <strong>Earnings</strong> in the Upcoming Catalysts table is each top-10 ticker&apos;s next
        scheduled report, pulled from <code>EARNINGS_CALENDAR</code> instead — a free account and
        <code>ALPHA_VANTAGE_API_KEY</code> unlock both; without one, Earnings rows are simply absent
        rather than the page failing. Neither Alpha Vantage endpoint distinguishes before-open vs.
        after-close timing, so earnings reactions here are close-to-close over the report day
        itself, same as the macro rows. (The Overnight Gap view under Daypart Volume Analysis does
        distinguish that timing for its own earnings tags, via a different source — see its own
        methodology note.)
      </p>
    </section>
  );
}
