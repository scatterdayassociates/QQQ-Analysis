"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function formatVolume(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, startTime, endTime });
      const res = await fetch(`/api/daypart?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load daypart data");
      setData(json as DaypartData);
      setHoveredIndex(null);
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

  const buckets = data?.buckets ?? [];
  const displayedIndex = hoveredIndex ?? (buckets.length > 0 ? buckets.length - 1 : null);
  const displayedBucket = displayedIndex !== null ? buckets[displayedIndex] : null;

  const lastUpdatedLabel = useMemo(() => {
    if (!data) return loading ? "Loading…" : "";
    return `${data.date} · ${data.startTime}–${data.endTime} ET`;
  }, [data, loading]);

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Intraday Daypart — Volume &amp; Realized Volatility</h1>
          <p className="subtitle">
            15-minute buckets across the regular session (9:30 AM–4:00 PM ET), with a realized-volatility
            proxy plotted alongside QQQ/TQQQ volume.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="date-input">Date</label>
          <input
            id="date-input"
            type="date"
            className="mono"
            value={date}
            max={TODAY}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="from-input">From</label>
          <select id="from-input" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            {startOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="to-input">To</label>
          <select id="to-input" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
            {endOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-spacer" />
        <span className="last-updated mono">{lastUpdatedLabel}</span>
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      <div className="legend">
        <span className="swatch">
          <i className="dot" style={{ background: "var(--accent-qqq)" }} />
          QQQ Volume
        </span>
        <span className="swatch">
          <i className="dot" style={{ background: "var(--accent-tqqq)" }} />
          TQQQ Volume
        </span>
        <span className="swatch">
          <i className="dot line" style={{ background: "var(--accent-vol)" }} />
          Realized Vol (proxy)
        </span>
      </div>

      {error && <div className="error-box">{error}</div>}

      {!error && buckets.length > 0 && (
        <>
          <div className="card">
            <div className="readout">
              <div className="stat">
                <span className="k">Time (ET)</span>
                <span className="v mono">{displayedBucket ? `${displayedBucket.time} ET` : "—"}</span>
              </div>
              <div className="stat">
                <span className="k">QQQ Volume</span>
                <span className="v qqq mono">{formatVolume(displayedBucket?.qqqVolume ?? null)}</span>
              </div>
              <div className="stat">
                <span className="k">TQQQ Volume</span>
                <span className="v tqqq mono">{formatVolume(displayedBucket?.tqqqVolume ?? null)}</span>
              </div>
              <div className="stat">
                <span className="k">Realized Vol</span>
                <span className="v vol mono">
                  {displayedBucket?.volatilityPct !== null && displayedBucket?.volatilityPct !== undefined
                    ? displayedBucket.volatilityPct.toFixed(2)
                    : "—"}
                </span>
              </div>
            </div>
            <div className="chart-wrap">
              <DaypartChart buckets={buckets} hoveredIndex={hoveredIndex} onHover={setHoveredIndex} />
            </div>
          </div>

          <div className="card">
            <DaypartTable buckets={buckets} hoveredIndex={hoveredIndex} onHover={setHoveredIndex} />
          </div>
        </>
      )}

      {!error && !loading && buckets.length === 0 && (
        <div className="skeleton">
          No trading data for {date} between {startTime} and {endTime} (market holiday or weekend?).
        </div>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> The volatility line uses the Parkinson range estimator — computed
        from each 15-minute QQQ bar&apos;s own high/low and annualized to a percentage — as a stand-in for
        implied volatility. True IV belongs to individual option contracts (strike + expiry), not the
        underlying ticker, and a market-wide index like VIX is billed as a separate Indices subscription;
        this proxy needs neither, since it&apos;s derived entirely from the QQQ volume data already being
        fetched. It is <em>realized</em> (backward-looking, from price ranges), not <em>implied</em>
        (forward-looking, from option prices) volatility. Volume and price ranges are read from the
        Massive Custom Bars endpoint in 15-minute buckets, Eastern Time.
      </p>
    </section>
  );
}
