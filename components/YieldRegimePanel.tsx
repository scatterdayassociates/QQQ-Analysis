"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DailyRegimeRow, OverlayPoint, RegimeCurrentState, RegimeEpisode, RegimeLabel } from "@/lib/yieldRegime";
import RegimeChart, { regimeSlug } from "./RegimeChart";

const RANGES = ["1M", "3M", "6M", "1Y", "5Y", "Max"] as const;
type Range = (typeof RANGES)[number];

const ALL_REGIMES: RegimeLabel[] = [
  "Growth Steepening",
  "Term Premium Steepening",
  "Steepening (Mixed)",
  "Bull Flattening",
  "Bear Flattening",
  "Flattening (Mixed)",
  "Range-bound / No Signal",
];

interface YieldRegimeResponse {
  current: RegimeCurrentState;
  series: DailyRegimeRow[];
  episodes: RegimeEpisode[];
  range: string;
}

function fmtPct(v: number | null, digits = 2): string {
  return v === null ? "—" : `${v.toFixed(digits)}%`;
}

function fmtSignedPct(v: number | null, digits = 2): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function pctClass(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? "up" : "down";
}

function RegimeChip({ regime }: { regime: RegimeLabel | null }) {
  if (!regime) return <span>—</span>;
  return <span className={`regime-chip regime-${regimeSlug(regime)}`}>{regime}</span>;
}

export default function YieldRegimePanel() {
  const [range, setRange] = useState<Range>("1Y");
  const [data, setData] = useState<YieldRegimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const [showQqq, setShowQqq] = useState(true);
  const [showTqqq, setShowTqqq] = useState(false);
  const [showYieldLines, setShowYieldLines] = useState(false);
  const [qqqOverlay, setQqqOverlay] = useState<OverlayPoint[] | null>(null);
  const [tqqqOverlay, setTqqqOverlay] = useState<OverlayPoint[] | null>(null);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/yield-regime?range=${r}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load regime data");
      setData(json as YieldRegimeResponse);
      setHoveredIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load regime data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const loadOverlay = useCallback(async (symbol: "QQQ" | "TQQQ", r: Range): Promise<OverlayPoint[] | null> => {
    try {
      const res = await fetch(`/api/yield-regime/overlay?symbol=${symbol}&range=${r}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load overlay");
      return json.series as OverlayPoint[];
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!showQqq) {
      setQqqOverlay(null);
      return;
    }
    let cancelled = false;
    loadOverlay("QQQ", range).then((series) => {
      if (!cancelled) setQqqOverlay(series);
    });
    return () => {
      cancelled = true;
    };
  }, [showQqq, range, loadOverlay]);

  useEffect(() => {
    if (!showTqqq) {
      setTqqqOverlay(null);
      return;
    }
    let cancelled = false;
    loadOverlay("TQQQ", range).then((series) => {
      if (!cancelled) setTqqqOverlay(series);
    });
    return () => {
      cancelled = true;
    };
  }, [showTqqq, range, loadOverlay]);

  const series = data?.series ?? [];
  const episodes = data?.episodes ?? [];

  const displayedIndex = hoveredIndex ?? (series.length > 0 ? series.length - 1 : null);
  const displayedRow = displayedIndex !== null ? series[displayedIndex] : null;
  const displayedQqqClose = useMemo(() => {
    if (!displayedRow || !qqqOverlay) return null;
    return qqqOverlay.find((o) => o.date === displayedRow.date)?.close ?? null;
  }, [displayedRow, qqqOverlay]);

  const qqqAsOf = qqqOverlay && qqqOverlay.length > 0 ? qqqOverlay[qqqOverlay.length - 1].date : null;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>T10Y2Y Regime Classification</h1>
          <p className="subtitle">
            Classifies the current 10Y-2Y Treasury yield-curve regime — growth-driven vs. term-premium-driven
            steepening, bull vs. bear flattening — and overlays it against QQQ/TQQQ price action so regime
            shifts can be visually cross-referenced against equity direction.
          </p>
        </div>
        <button className="apply" onClick={() => load(range)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && !error && (
        <>
          <div className="card">
            <div className="chart-label">Current State</div>
            <div className="readout">
              <div className="stat">
                <span className="k">Regime</span>
                <span className="v">
                  <RegimeChip regime={data.current.regime} />
                </span>
              </div>
              <div className="stat">
                <span className="k">Days in Regime</span>
                <span className="v mono">{data.current.daysInRegime ?? "—"}</span>
              </div>
              <div className="stat">
                <span className="k">Spread (10Y-2Y)</span>
                <span className="v mono">{fmtPct(data.current.spread)}</span>
              </div>
              <div className="stat">
                <span className="k">10Y Yield</span>
                <span className="v mono">{fmtPct(data.current.y10)}</span>
              </div>
              <div className="stat">
                <span className="k">2Y Yield</span>
                <span className="v mono">{fmtPct(data.current.y2)}</span>
              </div>
            </div>
            <p className="data-as-of">Treasury data as of {data.current.asOfDate ?? "—"} (FRED DGS10/DGS2).</p>
          </div>

          <div className="card">
            <div className="chart-label">T10Y2Y Spread &amp; Regime History</div>

            <div className="toolbar">
              <div className="field">
                <label>Range</label>
                <div className="range-selector">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`range-btn${range === r ? " active" : ""}`}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar-spacer" />
              <div className="overlay-toggles">
                <label>
                  <input type="checkbox" checked={showQqq} onChange={(e) => setShowQqq(e.target.checked)} />
                  QQQ overlay
                </label>
                <label>
                  <input type="checkbox" checked={showTqqq} onChange={(e) => setShowTqqq(e.target.checked)} />
                  TQQQ overlay
                </label>
                <label>
                  <input type="checkbox" checked={showYieldLines} onChange={(e) => setShowYieldLines(e.target.checked)} />
                  Raw 10Y/2Y lines
                </label>
              </div>
            </div>

            <div className="legend">
              <span className="swatch">
                <i className="dot line" style={{ background: "var(--text)" }} />
                T10Y2Y Spread
              </span>
              {showYieldLines && (
                <>
                  <span className="swatch">
                    <i className="dot line" style={{ background: "var(--accent-vol)" }} />
                    10Y Yield
                  </span>
                  <span className="swatch">
                    <i className="dot line" style={{ background: "var(--accent-earnings)" }} />
                    2Y Yield
                  </span>
                </>
              )}
              {showQqq && (
                <span className="swatch">
                  <i className="dot line" style={{ background: "var(--accent-qqq)" }} />
                  QQQ Close (right axis)
                </span>
              )}
              {showTqqq && (
                <span className="swatch">
                  <i className="dot line" style={{ background: "var(--accent-tqqq)" }} />
                  TQQQ Close (right axis)
                </span>
              )}
            </div>

            <div className="readout">
              <div className="stat">
                <span className="k">Date</span>
                <span className="v mono">{displayedRow?.date ?? "—"}</span>
              </div>
              <div className="stat">
                <span className="k">Spread</span>
                <span className="v mono">{fmtPct(displayedRow?.spread ?? null)}</span>
              </div>
              <div className="stat">
                <span className="k">10Y</span>
                <span className="v mono">{fmtPct(displayedRow?.y10 ?? null)}</span>
              </div>
              <div className="stat">
                <span className="k">2Y</span>
                <span className="v mono">{fmtPct(displayedRow?.y2 ?? null)}</span>
              </div>
              <div className="stat">
                <span className="k">Regime</span>
                <span className="v">
                  <RegimeChip regime={displayedRow?.regime ?? null} />
                </span>
              </div>
              {showQqq && (
                <div className="stat">
                  <span className="k">QQQ Close</span>
                  <span className="v qqq mono">{displayedQqqClose !== null ? `$${displayedQqqClose.toFixed(2)}` : "—"}</span>
                </div>
              )}
            </div>

            <div className="chart-wrap">
              <RegimeChart
                series={series}
                qqqOverlay={showQqq ? qqqOverlay : null}
                tqqqOverlay={showTqqq ? tqqqOverlay : null}
                showYieldLines={showYieldLines}
                hoveredIndex={hoveredIndex}
                onHover={setHoveredIndex}
              />
            </div>

            <div className="regime-legend">
              {ALL_REGIMES.map((r) => (
                <RegimeChip key={r} regime={r} />
              ))}
            </div>

            {showQqq && <p className="data-as-of">QQQ price data as of {qqqAsOf ?? "loading…"} (Massive Custom Bars).</p>}
          </div>

          <div className="card">
            <div className="chart-label">Regime Episode History ({episodes.length})</div>
            <div className="table-wrap">
              <table className="mono">
                <thead>
                  <tr>
                    <th>Regime</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Duration (days)</th>
                    <th>Spread Δ</th>
                    <th>QQQ % Chg</th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((ep, i) => (
                    <tr key={`${ep.startDate}-${i}`}>
                      <td>
                        <RegimeChip regime={ep.regime} />
                      </td>
                      <td>{ep.startDate}</td>
                      <td>{ep.endDate ?? "Current"}</td>
                      <td>{ep.durationTradingDays}</td>
                      <td className={pctClass(ep.spreadChange)}>{fmtSignedPct(ep.spreadChange)}</td>
                      <td className={pctClass(ep.qqqPctChange)}>{fmtSignedPct(ep.qqqPctChange)}</td>
                    </tr>
                  ))}
                  {episodes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="skeleton">
                        No episodes yet — check DATABASE_URL and Vercel logs for <code>[yield-regime]</code> lines.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <details className="card table-accordion">
            <summary>
              <span>Daily Detail ({range})</span>
              <span className="table-accordion-meta mono">
                <span className="table-accordion-count">{series.length} rows</span>
                <svg className="table-accordion-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="table-accordion-body">
              <div className="table-wrap">
                <table className="mono">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>10Y</th>
                      <th>2Y</th>
                      <th>Spread</th>
                      <th>Regime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{fmtPct(r.y10)}</td>
                        <td>{fmtPct(r.y2)}</td>
                        <td>{fmtPct(r.spread)}</td>
                        <td>
                          <RegimeChip regime={r.regime} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </>
      )}

      <div className="footnote">
        <p>
          <strong>Methodology.</strong> Classifies each trading day into one of seven states based on the{" "}
          <em>change</em> in the T10Y2Y spread (10Y minus 2Y Treasury yield) over a trailing lookback window,
          combined with which leg — the 2Y (front end) or the 10Y (long end) — is driving that change.
          Spread widening (steepening) splits into <strong>Growth Steepening</strong> (2Y falling faster than
          10Y — rate-cut expectations building, typically NDX-supportive) vs.{" "}
          <strong>Term Premium Steepening</strong> (10Y rising faster than 2Y — inflation/fiscal/supply
          concerns, typically a headwind for duration-sensitive names like NDX). Spread narrowing (flattening)
          splits into <strong>Bull Flattening</strong> (10Y falling faster — growth/recession fear, ambiguous
          for NDX depending on which) vs. <strong>Bear Flattening</strong> (2Y rising faster — Fed hiking,
          classic late-cycle tightening). Moves that don&apos;t clearly fit either sub-case land in{" "}
          <strong>Steepening (Mixed)</strong> / <strong>Flattening (Mixed)</strong>, and moves smaller than
          the threshold land in <strong>Range-bound / No Signal</strong>.
        </p>
        <p>
          <strong>Threshold &amp; lookback</strong> default to 5bps change in the spread over 10 trading days
          (both configurable via <code>REGIME_THRESHOLD_BPS</code> / <code>REGIME_LOOKBACK_DAYS</code>) — this
          smooths out single-day noise so the regime label doesn&apos;t flip on every small wiggle.
        </p>
        <p>
          <strong>Data source.</strong> 10Y/2Y yields come from FRED&apos;s public <code>DGS10</code>/
          <code>DGS2</code> series (no API key, no rate limit) rather than Alpha Vantage&apos;s{" "}
          <code>TREASURY_YIELD</code> endpoint — same free, key-free convention already used elsewhere in
          this app for VIX/USD-index proxies (see Fundamental Analysis). A day only counts if both series have
          a real observation that day (weekends, and the bond market&apos;s own holiday calendar, which
          differs slightly from the equity calendar, are excluded automatically rather than forward-filled
          into the regime calculation) — the chart still reads as continuous because a line naturally
          connects across those gaps.
        </p>
        <p>
          <strong>Persistence.</strong> Unlike every other tab in this app, this one is backed by MySQL
          (the only tab with any persistent state) — the episode table is derived by walking the entire yield
          history, which is too expensive to redo on every page load. Data is kept fresh automatically: every
          load checks whether the newest stored trading day is current and re-fetches/recomputes if not, so
          freshness never depends on the optional Vercel Cron job (<code>vercel.json</code>) actually firing —
          that cron is a pre-warming nicety, not a requirement. Backfill starts 2000-01-01 by default (covers
          QQQ&apos;s full trading history for the episode overlay), overridable via{" "}
          <code>REGIME_BACKFILL_START</code> — FRED itself has DGS10 data back to 1962.
        </p>
        <p>
          <strong>QQQ % Chg</strong> in the episode table is QQQ&apos;s close-to-close % change from the
          episode&apos;s start to its end (or today, if still ongoing), via Massive&apos;s Custom Bars — same
          <code>MASSIVE_API_KEY</code> used elsewhere, computed once during the daily refresh rather than on
          every page load. <strong>TQQQ</strong> is available as a chart overlay but is deliberately not a
          second episode-table column, to keep that table focused on the regime signal itself rather than
          TQQQ&apos;s own decay characteristics (a separate topic). NDX-100 index-level data is not used as
          the equity proxy since Massive&apos;s Indices product tier (which would carry it) isn&apos;t
          included in this account&apos;s current plan — QQQ tracks NDX-100 closely enough for this purpose,
          with a small, well-known expense-ratio drag over long lookbacks.
        </p>
      </div>
    </section>
  );
}
