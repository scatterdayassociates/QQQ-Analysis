"use client";

import { useCallback, useEffect, useState } from "react";
import type { DaypartData } from "@/lib/massive";
import DaypartChart from "./DaypartChart";
import DaypartTable from "./DaypartTable";

const MARKET_OPEN = "09:30";
const MARKET_CLOSE = "16:00";

function generateTimeOptions(start: string, end: string, stepMinutes: number): string[] {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  const options: string[] = [];
  for (let minutes = startTotal; minutes <= endTotal; minutes += stepMinutes) {
    const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
    const minute = (minutes % 60).toString().padStart(2, "0");
    options.push(`${hour}:${minute}`);
  }
  return options;
}

function defaultEtDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return formatter.format(new Date());
}

const TIME_OPTIONS = generateTimeOptions(MARKET_OPEN, MARKET_CLOSE, 15);
const TODAY = defaultEtDate();

export default function DaypartPanel() {
  const [date, setDate] = useState(TODAY);
  const [startTime, setStartTime] = useState(MARKET_OPEN);
  const [endTime, setEndTime] = useState(MARKET_CLOSE);
  const [data, setData] = useState<DaypartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, startTime, endTime });
      const res = await fetch(`/api/daypart?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load daypart data");
      setData(json as DaypartData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load daypart data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date, startTime, endTime]);

  useEffect(() => {
    load();
  }, [load]);

  const startOptions = TIME_OPTIONS.filter((t) => t < endTime);
  const endOptions = TIME_OPTIONS.filter((t) => t > startTime);

  return (
    <section className="daypart-panel">
      <div className="daypart-header">
        <h2>Intraday Daypart — Volume &amp; VIX (IV proxy)</h2>
        <div className="daypart-filters">
          <label>
            Date
            <input type="date" value={date} max={TODAY} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            From
            <select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              {startOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {endOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button className="refresh-btn" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </button>
        </div>
      </div>

      <div className="daypart-legend">
        <span>
          <i className="dot dot-qqq" /> QQQ Volume
        </span>
        <span>
          <i className="dot dot-tqqq" /> TQQQ Volume
        </span>
        <span>
          <i className="dot dot-vix" /> VIX (IV proxy)
        </span>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && data.buckets.length > 0 && !error && (
        <>
          <DaypartChart buckets={data.buckets} />
          <DaypartTable buckets={data.buckets} />
        </>
      )}

      {data && data.buckets.length === 0 && !error && (
        <div className="skeleton">
          No trading data for {date} between {startTime} and {endTime} (market holiday or weekend?).
        </div>
      )}

      <p className="footer-note daypart-note">
        VIX (CBOE Volatility Index) is used as a market-wide implied-volatility proxy for both QQQ and
        TQQQ, since IV itself is a property of individual option contracts rather than the underlying
        ticker. Volume and VIX are pulled from the Custom Bars endpoint in 15-minute buckets, Eastern
        Time.
      </p>
    </section>
  );
}
