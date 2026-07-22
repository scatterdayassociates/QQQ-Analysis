"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalystTrackerData, CatalystReaction } from "@/lib/catalysts";

const EVENT_TYPES = ["FOMC", "CPI", "NFP"] as const;

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/catalysts");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load catalyst tracker data");
      setData(json as CatalystTrackerData);
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
        COST, NFLX) reflects Nasdaq-100/QQQ weightings as of mid-2026 — it&apos;s a fixed snapshot, not a
        continuously-rebalanced live ranking, since weights drift with price and the index rebalances
        quarterly. Price, change, and volume come from Massive&apos;s Custom Bars endpoint; market cap
        comes from Massive&apos;s Ticker Details (reference) endpoint and shows “—” if unavailable on the
        current plan. <strong>Days Till Earnings</strong> is each ticker&apos;s next scheduled report
        date (from Finnhub, same source as Upcoming Catalysts) minus today&apos;s date, and shows “—”
        if no report is scheduled within the lookahead window or Finnhub isn&apos;t configured. The macro calendar (FOMC rate decisions, CPI releases, jobs reports) is compiled
        from the Federal Reserve&apos;s and BLS&apos;s published schedules — historical reactions are
        computed as the real close-to-close % move from the trading day before each event to the event
        day itself, covering Jan 2026–present. <strong>Earnings</strong> in the Upcoming Catalysts table
        is each top-10 ticker&apos;s next scheduled report, pulled live from Finnhub&apos;s free-tier
        Earnings Calendar API — a free account and <code>FINNHUB_API_KEY</code> unlock it; without one,
        those rows are simply absent rather than the page failing. Historical reactions don&apos;t
        include past earnings dates, since there&apos;s no verified historical-earnings source
        wired up here, and hardcoding those risks showing stale or wrong dates.
      </p>
    </section>
  );
}
