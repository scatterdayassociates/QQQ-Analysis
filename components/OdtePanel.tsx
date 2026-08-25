"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GateCondition, ImSeriesPoint, OdteStatus } from "@/lib/odte/types";

function fmtPctMove(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(2)}%`;
}

function fmtCheapness(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtGex(v: number | null): string {
  if (v === null) return "—";
  const billions = v / 1e9;
  return `${billions >= 0 ? "+" : "−"}$${Math.abs(billions).toFixed(2)}B / 1%`;
}

function fmtEtStamp(iso: string | null, ageMinutes: number | null): string {
  if (!iso) return "no data received yet";
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return `data as of ${et} ET (15-min delayed feed${ageMinutes !== null ? `, ${ageMinutes} min old` : ""})`;
}

// Chart geometry: x is ET session time (9:30–16:00), equal minutes per pixel.
const CHART_W = 960;
const CHART_H = 260;
const PAD = { top: 16, right: 56, bottom: 26, left: 8 };
const SESSION_START = 9 * 60 + 30;
const SESSION_END = 16 * 60;

function xForMinutes(m: number): number {
  const frac = (m - SESSION_START) / (SESSION_END - SESSION_START);
  return PAD.left + frac * (CHART_W - PAD.left - PAD.right);
}

function minutesOf(etTime: string): number {
  const [h, m] = etTime.split(":").map(Number);
  return h * 60 + m;
}

function ConvergenceChart({ series }: { series: ImSeriesPoint[] }) {
  const values = series.flatMap((p) => [p.imRemaining, p.cemRemaining]).filter((v): v is number => v !== null);
  if (series.length === 0 || values.length === 0) {
    return <div className="skeleton">No evaluation passes recorded yet today — the chart fills in every ~2 minutes during market hours.</div>;
  }
  const maxV = Math.max(...values) * 1.15;
  const yFor = (v: number) => PAD.top + (1 - v / maxV) * (CHART_H - PAD.top - PAD.bottom);

  const line = (key: "imRemaining" | "cemRemaining") =>
    series
      .filter((p) => p[key] !== null)
      .map((p) => `${xForMinutes(minutesOf(p.etTime)).toFixed(1)},${yFor(p[key] as number).toFixed(1)}`)
      .join(" ");

  const windows = [
    { from: "10:05", to: "11:30" },
    { from: "13:45", to: "15:00" },
  ];
  const hourTicks = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
  const last = series[series.length - 1];

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="odte-chart" role="img" aria-label="Implied vs conditional expected move through the session">
      {/* G3 decision windows */}
      {windows.map((w) => (
        <rect
          key={w.from}
          x={xForMinutes(minutesOf(w.from))}
          y={PAD.top}
          width={xForMinutes(minutesOf(w.to)) - xForMinutes(minutesOf(w.from))}
          height={CHART_H - PAD.top - PAD.bottom}
          className="odte-chart-window"
        />
      ))}
      {/* hour gridlines + labels */}
      {hourTicks.map((t) => (
        <g key={t}>
          <line x1={xForMinutes(minutesOf(t))} x2={xForMinutes(minutesOf(t))} y1={PAD.top} y2={CHART_H - PAD.bottom} className="odte-chart-grid" />
          <text x={xForMinutes(minutesOf(t))} y={CHART_H - 8} textAnchor="middle" className="odte-chart-tick">
            {t}
          </text>
        </g>
      ))}
      <polyline points={line("imRemaining")} fill="none" stroke="var(--accent-qqq)" strokeWidth={2} />
      <polyline points={line("cemRemaining")} fill="none" stroke="var(--accent-vol)" strokeWidth={2} strokeDasharray="6 3" />
      {last.imRemaining !== null && (
        <text x={CHART_W - PAD.right + 4} y={yFor(last.imRemaining) + 4} className="odte-chart-label-im">
          IM {fmtPctMove(last.imRemaining)}
        </text>
      )}
      {last.cemRemaining !== null && (
        <text x={CHART_W - PAD.right + 4} y={yFor(last.cemRemaining) + 4} className="odte-chart-label-cem">
          CEM {fmtPctMove(last.cemRemaining)}
        </text>
      )}
    </svg>
  );
}

function ConditionRow({ condition }: { condition: GateCondition }) {
  return (
    <div className={`odte-cond${condition.pass ? " pass" : " fail"}`}>
      <span className="odte-cond-id">{condition.id}</span>
      <span className="odte-cond-name">{condition.name}</span>
      <span className="odte-cond-value mono">
        {condition.pass ? "✓" : "✗"} {condition.value} <span className="odte-cond-threshold">({condition.threshold})</span>
        {condition.note && <span className="odte-cond-note"> · {condition.note}</span>}
      </span>
    </div>
  );
}

export default function OdtePanel() {
  const [status, setStatus] = useState<OdteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/odte/status");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load 0DTE scanner status");
      setStatus(json as OdteStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load 0DTE scanner status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Passive refresh at the cron cadence — cheap (Postgres read only)
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  const gate = status?.gate ?? null;
  const context = status?.context ?? null;
  const cheapnessNow = useMemo(() => {
    const series = status?.series ?? [];
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].cheapness !== null) return series[i].cheapness;
    }
    return null;
  }, [status]);

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>0 DTE Opportunity Analysis</h1>
          <p className="subtitle">
            Conditions under which same-day QQQ options are underpricing the conditional expected move.
            Default state is <strong>NO TRADE</strong> — the tab must be argued into a trade state by
            explicit, logged conditions. Phase 1: gate + move convergence (candidate ranking ships after
            the gate is validated live).
          </p>
        </div>
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {status && !error && !status.session && (
        <div className="card">
          <div className="chart-label">Scanner not initialized</div>
          <p className="odte-setup-note">
            No session has been recorded yet. The scanner initializes itself on the next weekday at 9:15 AM ET
            via Vercel Cron. First-time setup checklist: (1) add <code>ODTE_DATABASE_URL</code> to the Vercel
            project&apos;s environment variables, (2) hit <code>/api/odte/migrate?secret=…</code> once to create the
            schema, (3) wait for the next market session — or trigger <code>/api/odte/cron/session-init</code> and{" "}
            <code>/api/odte/cron/tick</code> manually during market hours.
          </p>
        </div>
      )}

      {status && !error && status.session && (
        <>
          <div className={`card odte-gate-banner ${gate?.state === "TRADE" ? "open" : "closed"}`}>
            <div className="odte-gate-head">
              <span className="odte-gate-state">{gate ? (gate.state === "TRADE" ? "TRADE WINDOW OPEN" : "NO TRADE") : "AWAITING FIRST PASS"}</span>
              <span className="odte-stamp mono">{fmtEtStamp(status.dataAsOf, status.dataAgeMinutes)}</span>
            </div>
            {status.marketClosed && (
              <p className="odte-closed-note">
                Market closed — showing the last recorded state for {status.session.tradeDate}. The gate resets to NO TRADE
                at the next open.
              </p>
            )}
            {gate?.recommendation && <p className="odte-recommendation">{gate.recommendation}</p>}
            {gate && (
              <div className="odte-conditions">
                {gate.conditions.map((c) => (
                  <ConditionRow key={c.id} condition={c} />
                ))}
              </div>
            )}
            <div className="odte-budget-row">
              <span className="odte-budget-label">
                Daily risk budget: <strong>${status.riskBudget.usedUsd}</strong> used of <strong>${status.riskBudget.totalUsd}</strong>
              </span>
              <span className="odte-basecase">Base case for any 0DTE long premium: −100% of premium.</span>
            </div>
          </div>

          <div className="odte-row2">
            <div className="card odte-convergence">
              <div className="table-toolbar">
                <span className="chart-label">Implied vs. Conditional Expected Move (remaining)</span>
                <span className="odte-legend mono">
                  <span className="odte-legend-im">— IM</span> <span className="odte-legend-cem">--- CEM</span>{" "}
                  <span>· shaded = decision windows · cheapness now: {fmtCheapness(cheapnessNow)}</span>
                </span>
              </div>
              <ConvergenceChart series={status.series} />
            </div>

            <div className="card odte-context">
              <div className="chart-label">Session Context</div>
              <div className="odte-context-grid mono">
                <span>Dealer GEX (est.)</span>
                <span className={context?.gexTotal !== null && context !== null && (context.gexTotal ?? 0) < 0 ? "down" : "up"}>
                  {fmtGex(context?.gexTotal ?? null)}
                </span>
                <span>GEX flip strike</span>
                <span>{context?.gexFlipStrike ?? "—"}</span>
                <span>IV term (0DTE/weekly)</span>
                <span>
                  {context?.ivTermRatio?.toFixed(3) ?? "—"}
                  {status.session.weeklyExpiry ? ` (vs ${status.session.weeklyExpiry})` : ""}
                </span>
                <span>Yield regime</span>
                <span>{context?.regime ?? "—"}</span>
                <span>Catalyst</span>
                <span>{context?.catalyst ?? "none"}</span>
                <span>Opening IM</span>
                <span>{fmtPctMove(status.session.impliedMoveOpen)}</span>
                <span>IM percentile</span>
                <span>
                  {context?.imPercentile !== null && context !== undefined && context !== null
                    ? `${context.imPercentile}%`
                    : `n/a (${context?.imPercentileSessions ?? 0} sessions recorded)`}
                </span>
                <span>Opening range</span>
                <span>{fmtPctMove(status.session.orRange)}</span>
                <span>QQQ spot (T-15)</span>
                <span>{status.session.spot !== null ? `$${status.session.spot.toFixed(2)}` : "—"}</span>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> All data comes from Massive&apos;s Options + Stocks Starter plans and is{" "}
        <strong>15 minutes delayed</strong> — every value on this tab is a regime-level signal, not an
        execution price; final quote checks happen in your trading platform on live data. The{" "}
        <strong>implied move</strong> (IM) is the 0DTE ATM straddle premium as a % of spot, repriced each
        ~2-minute pass; the confirmed live snapshot payload carries no bid/ask, so premiums use each
        contract&apos;s last trade (<code>day.close</code>) and spread-based liquidity checks are replaced by
        volume (flagged on G4). The <strong>conditional expected move</strong> (CEM) is the opening range
        (first 30 min, % of open) × a remaining-range expansion factor estimated from recent sessions&apos;
        minute bars × regime multipliers (dealer short gamma ×1.15, inverted IV term structure ×1.10,
        FOMC/CPI/NFP catalyst ×1.10, Term-Premium-Steepening yield regime ×1.05, capped ×1.45 combined).{" "}
        <strong>Cheapness</strong> = IM ÷ CEM: below 0.85 the market is underpricing the conditional move.
        The <strong>IV term ratio</strong> divides 0DTE ATM IV by the nearest ~weekly expiry&apos;s ATM IV
        (chain-derived — no VIX subscription); above 1.0 is a short-dated-stress analog of backwardation.{" "}
        <strong>Dealer GEX</strong> uses the standard dealers-long-calls / short-puts convention and daily
        open interest — it is an estimate. The gate (G1–G7) requires every condition to pass and re-arms to
        NO TRADE each morning; a quiet tab saying &quot;not today&quot; is the tool working as designed, not an
        empty state. Yield regime comes from the TBill Yield Spread Analysis tab&apos;s classifier; the macro
        catalyst calendar is shared with the Catalyst Tracker tab.
      </p>
    </section>
  );
}
