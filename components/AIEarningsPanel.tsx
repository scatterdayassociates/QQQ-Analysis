"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiEarningsData, AiEarningsScore } from "@/lib/aiEarnings";

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Hyperscaler",
  2: "Leveraged Buyer",
  3: "Credit-Risk Tail",
};

function fmtRatio(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function fmtSignedPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function scoreClass(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? "down" : "up"; // higher fragility score = more fragile = warning color
}

export default function AIEarningsPanel() {
  const [data, setData] = useState<AiEarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-earnings");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load AI earnings analysis");
      setData(json as AiEarningsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI earnings analysis");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>AI Earnings Analysis</h1>
          <p className="subtitle">
            AI-capex buyer fragility screen — are these names still funding infrastructure spend from
            operating cash flow, or increasingly from debt and equity issuance?
          </p>
        </div>
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && !error && (
        <div className="card">
          <div className="chart-label">
            Buyer Fragility Score{" "}
            {data.tickersWithData < data.tickersRequested
              ? `(${data.tickersWithData}/${data.tickersRequested} tickers returned data)`
              : ""}
          </div>
          <div className="table-wrap">
            <table className="mono">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Tier</th>
                  <th>Latest Qtr</th>
                  <th>Coverage</th>
                  <th>Capex/Rev</th>
                  <th>Financing</th>
                  <th>Trend</th>
                  <th>Buyback Δ YoY</th>
                  <th>Interest Exp YoY</th>
                  <th>Fragility Score</th>
                </tr>
              </thead>
              <tbody>
                {data.scores.map((s: AiEarningsScore) => (
                  <tr key={s.ticker}>
                    <td>
                      {s.ticker}
                      <div style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>{s.name}</div>
                    </td>
                    <td>
                      <span className={`event-chip tier-${s.tier}`}>{TIER_LABELS[s.tier]}</span>
                    </td>
                    <td>{s.latestQuarter}</td>
                    <td>{fmtRatio(s.capexCoverageRatio)}x</td>
                    <td>{fmtPct(s.capexToRevenue)}</td>
                    <td>{fmtRatio(s.financingDependency)}x</td>
                    <td className={s.coverageTrend !== null ? (s.coverageTrend >= 0 ? "up" : "down") : undefined}>
                      {fmtRatio(s.coverageTrend)}
                    </td>
                    <td>{fmtUsd(s.buybackDeltaYoy)}</td>
                    <td>{fmtSignedPct(s.interestExpenseYoyGrowth)}</td>
                    <td className={scoreClass(s.fragilityScore)}>{fmtRatio(s.fragilityScore)}</td>
                  </tr>
                ))}
                {data.scores.length === 0 && (
                  <tr>
                    <td colSpan={10} className="skeleton">
                      No tickers returned usable fundamentals data — check ALPHA_VANTAGE_API_KEY and
                      Vercel logs for <code>[ai-earnings]</code> lines.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> Screens a fixed universe (Alphabet, Microsoft, Meta, Amazon,
        Oracle, CoreWeave) tiered by capex-funding posture — Tier 1 hyperscalers still funding mostly
        from operations (so far), Tier 2 leveraged buyers increasingly using debt/equity issuance,
        Tier 3 the highest-beta/credit-risk names most exposed if the cycle cracks. All figures come
        from Alpha Vantage&apos;s <code>CASH_FLOW</code> and <code>INCOME_STATEMENT</code> endpoints
        (same <code>ALPHA_VANTAGE_API_KEY</code> used elsewhere in this app) — 2 requests per ticker,
        12 total per load, cached 24 hours since quarterly fundamentals only change 4x/year; a
        rate-limited or missing ticker just drops out of the table rather than failing the page.{" "}
        <strong>Coverage</strong> = operating cash flow ÷ capex, latest quarter (below 1.0x means
        capex wasn&apos;t covered by operations that quarter). <strong>Capex/Rev</strong> and{" "}
        <strong>Financing</strong> (debt + equity issued ÷ capex) use trailing 4-quarter averages
        rather than latest-quarter-only, so a single one-off raise (like a large one-time equity
        issuance) doesn&apos;t outrank a name that has been persistently externally-funding capex for
        years. <strong>Trend</strong> = latest coverage ratio minus the same quarter last year
        (negative = deteriorating). <strong>Buyback Δ YoY</strong> = buybacks this quarter minus a
        year ago — a sharp cut is often the first lever management pulls before touching the capex
        plan. <strong>Fragility Score</strong> combines all of the above into one cross-sectional
        z-scored composite (recalibrates automatically as tickers are added) — higher means more
        fragile.
      </p>
    </section>
  );
}
