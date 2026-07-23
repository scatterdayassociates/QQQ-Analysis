"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaypartData } from "@/lib/massive";
import { MARKET_OPEN, MARKET_CLOSE, TIME_OPTIONS, defaultEtDate } from "@/lib/marketHours";
import DaypartChart from "./DaypartChart";
import DaypartTable from "./DaypartTable";

function formatVolume(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
}

const TODAY = defaultEtDate();

interface DaypartEntryProps {
  entryId: number;
  label: string;
  showRemove: boolean;
  onRemove: () => void;
}

export default function DaypartEntry({ entryId, label, showRemove, onRemove }: DaypartEntryProps) {
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

  const dateInputId = `date-input-${entryId}`;
  const fromInputId = `from-input-${entryId}`;
  const toInputId = `to-input-${entryId}`;

  return (
    <div className="daypart-entry">
      <div className="daypart-entry-head">
        <span className="daypart-entry-label">{label}</span>
        {showRemove && (
          <button type="button" className="remove-btn" onClick={onRemove} aria-label={`Remove ${label}`}>
            ×
          </button>
        )}
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor={dateInputId}>Date</label>
          <input
            id={dateInputId}
            type="date"
            className="mono"
            value={date}
            max={TODAY}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={fromInputId}>From</label>
          <select id={fromInputId} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            {startOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={toInputId}>To</label>
          <select id={toInputId} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
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
            <p className="footnote chart-footnote">
              <strong>Realized Vol (proxy)</strong> = Parkinson (1980) range estimator, computed from
              each 15-minute QQQ bar&apos;s own high/low and annualized to a VIX-comparable percentage.
              It is not real VIX — Massive&apos;s VIX index data requires a separate paid Indices
              subscription (confirmed unavailable on the current plan), and neither Alpha Vantage nor
              FRED provide intraday VIX either (Alpha Vantage doesn&apos;t offer index data at all;
              FRED&apos;s VIX series is daily-close-only). This proxy needs none of that, since
              it&apos;s derived entirely from the QQQ bar data already being fetched for volume.
            </p>
          </div>

          <details className="card table-accordion">
            <summary>
              <span>Data table</span>
              <span className="table-accordion-meta mono">
                <span className="table-accordion-count">{buckets.length} rows</span>
                <svg className="table-accordion-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="table-accordion-body">
              <DaypartTable buckets={buckets} hoveredIndex={hoveredIndex} onHover={setHoveredIndex} />
            </div>
          </details>
        </>
      )}

      {!error && !loading && buckets.length === 0 && (
        <div className="skeleton">
          No trading data for {date} between {startTime} and {endTime} (market holiday or weekend?).
        </div>
      )}
    </div>
  );
}
