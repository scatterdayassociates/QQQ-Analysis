"use client";

import { useCallback, useEffect, useState } from "react";
import type { TickerDashboardData } from "@/lib/massive";
import TickerCard from "@/components/TickerCard";

const TICKERS = ["QQQ", "TQQQ"];

export default function Home() {
  const [data, setData] = useState<Record<string, TickerDashboardData>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        TICKERS.map(async (ticker) => {
          const res = await fetch(`/api/ticker-data?ticker=${ticker}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || `Failed to load ${ticker}`);
          return json as TickerDashboardData;
        })
      );
      const next: Record<string, TickerDashboardData> = {};
      for (const r of results) next[r.ticker] = r;
      setData(next);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>QQQ / TQQQ Dashboard</h1>
          <div className="subtitle">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Loading..."}
          </div>
        </div>
        <button className="refresh-btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards">
        {TICKERS.map((ticker) =>
          data[ticker] ? (
            <TickerCard key={ticker} data={data[ticker]} />
          ) : (
            !error && (
              <div className="card skeleton" key={ticker}>
                Loading {ticker}...
              </div>
            )
          )
        )}
      </div>

      <p className="footer-note">
        Data from the Massive market data API (Custom Bars for volume history, Daily Ticker
        Summary for close prices and % change). Prices are end-of-day; the dashboard refreshes
        every 60 seconds server-side and on demand via the Refresh button.
      </p>
    </main>
  );
}
