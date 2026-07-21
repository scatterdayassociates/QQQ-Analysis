"use client";

import { useCallback, useEffect, useState } from "react";
import type { FundamentalAnalysis } from "@/lib/fundamentals";
import StrengthGauge from "./StrengthGauge";

const EXPLANATIONS: Record<string, { title: string; body: string }> = {
  yield: {
    title: "Why the yield curve matters here",
    body: "The 10-year minus 2-year Treasury spread is one of the most closely watched macro recession signals: when short-term rates rise above long-term rates (a negative spread), it usually means the bond market expects the Fed to cut rates later because of economic weakness ahead. Counter-intuitively, the riskiest moment historically isn't the inversion itself — it's the ‘re-steepening’ that follows, when the spread crosses back above zero after having been negative. Equity drawdowns and recessions have tended to arrive during or shortly after that re-steepening, not during the inversion. That's why this model scores a freshly-positive spread that was recently inverted as the worst possible reading, even though a positive spread looks normal on the surface.",
  },
  trend: {
    title: "Why 200-day MA proximity matters here",
    body: "SPY's distance from its own 200-day moving average is a simple, durable trend filter: price comfortably above the 200MA reflects a structurally healthy uptrend, while price meaningfully below it reflects a broken, bearish structure. This model treats a drop of 2% or more below the 200MA as a hard override — regardless of how attractive any other metric looks, it refuses to recommend selling options premium into a confirmed downtrend, since volatility tends to expand (not contract) once a real breakdown is underway.",
  },
  credit: {
    title: "Why the credit ratio matters here",
    body: "HYG (high-yield ‘junk’ bond ETF) versus IEF (7–10 year Treasury ETF) captures whether credit investors are reaching for risk or fleeing to safety. Credit markets are dominated by large institutional investors who are often more attuned to corporate balance-sheet stress than equity traders, so credit often leads equities at inflection points — junk bonds cracking while stocks are still calm is a classic early warning sign. When HYG is outperforming its own 50-day trend relative to IEF, that reads as risk-on and supportive of selling premium; when Treasuries are leading, it suggests the market is quietly de-risking underneath the surface.",
  },
  breadth: {
    title: "Why sector breadth matters here",
    body: "This counts how many of the 11 S&P 500 sector SPDR ETFs are trading above their own 200-day moving averages. A rally where all 11 sectors participate is structurally sound; a rally propped up by only 2 or 3 sectors is fragile and historically more prone to sharp reversals once sentiment turns, because there's little underlying support if the leaders stumble. Breadth asks not just ‘is the index up?’ but ‘is the advance actually broad enough to trust?’",
  },
  vix: {
    title: "Why the VIX z-score matters here",
    body: "This measures how unusual today's VIX reading is relative to its own trailing 20-day average and standard deviation — a z-score of +2 means today's VIX is two standard deviations above its recent ‘normal’ level, i.e. a genuine volatility spike rather than routine noise. This model specifically hunts for a fresh, sharp VIX spike (an 8%+ jump paired with a z-score above 1.5) because that's exactly when option premiums get richest relative to the volatility that will likely follow — the setup for selling elevated, freshly-spiked volatility rather than chasing a slow grind higher.",
  },
  rsi: {
    title: "Why RSI-14 matters here",
    body: "The 14-day Relative Strength Index is a classic momentum oscillator flagging overbought conditions (high RSI, price has run hard) versus oversold conditions (low RSI, price has been sold off hard). This model inverts the usual reading (100 minus RSI) so a higher score corresponds to a more oversold market — this tactical framework leans contrarian for this signal, treating an oversold bounce as the more favorable setup. Methodology note: this uses a simple rolling average of gains/losses (matching the source model exactly) rather than Wilder's exponential smoothing used on most charting platforms, so the value here may read slightly differently than a typical chart's RSI.",
  },
  exhaustion: {
    title: "Why the exhaustion count matters here",
    body: "This is a simplified version of Tom DeMark's ‘TD Sequential’ setup counting: each day is compared to the close four trading days earlier, and consecutive days moving the same direction are tallied toward a ceiling of 9. A count approaching 9 is the classic DeMark signal that a directional move is stretched and due for at least a pause — a statement about how stretched the current run is, not a prediction of direction. The scoring here is deliberately contrarian: a long streak of down days pushes the score up (anticipating the down-move nearing exhaustion), while a long streak of up days pushes the score down (anticipating the up-move nearing exhaustion).",
  },
};

function actionClass(action: FundamentalAnalysis["action"]): string {
  if (action === "NO TRADE") return "action-no-trade";
  if (action === "SELL PREMIUM") return "action-sell-premium";
  return "action-wait";
}

function scoreClass(score: number): string {
  if (score >= 70) return "up";
  if (score <= 30) return "down";
  return "mid";
}

export default function FundamentalAnalysisPanel() {
  const [data, setData] = useState<FundamentalAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fundamentals");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load fundamental analysis");
      setData(json as FundamentalAnalysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fundamental analysis");
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
          <h1>Fundamental Analysis</h1>
          <p className="subtitle">
            A 7-metric market strength model spanning macro, trend, credit, breadth, and volatility
            signals, plus the tactical premium-selling decision they combine into.
          </p>
        </div>
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && !error && (
        <>
          <div className="fa-top-grid">
            <div className="card fa-decision-card">
              <div className="chart-label">Tactical Decision</div>
              <div className={`action-badge ${actionClass(data.action)}`}>{data.action}</div>
              <div className="fa-allocation">
                Suggested allocation: <strong className="mono">{data.allocationPct}%</strong>
              </div>
              <ul className="fa-trigger-list">
                <li className={data.triggers.downtrend ? "hit" : ""}>
                  {data.triggers.downtrend ? "✓" : "—"} Downtrend override (SPY ≤ -2% of 200MA)
                </li>
                <li className={data.triggers.environmentOk ? "hit" : ""}>
                  {data.triggers.environmentOk ? "✓" : "—"} Environment OK (credit + dollar + trend)
                </li>
                <li className={data.triggers.volatilitySpike ? "hit" : ""}>
                  {data.triggers.volatilitySpike ? "✓" : "—"} Volatility spike (VIX jump + z-score)
                </li>
              </ul>
            </div>

            <div className="card fa-gauge-card">
              <div className="chart-label">Aggregate Strength</div>
              <StrengthGauge value={data.averageScore} />
              <p className="fa-gauge-note">Average of all 7 metric scores below (0–100 scale).</p>
            </div>
          </div>

          <div className="fa-metric-grid">
            {data.metrics.map((m) => {
              const ex = EXPLANATIONS[m.key];
              return (
                <div className="card fa-metric-card" key={m.key}>
                  <div className="fa-metric-head">
                    <span className="fa-metric-label">{m.label}</span>
                    <span className={`fa-metric-score mono ${scoreClass(m.score)}`}>{m.score.toFixed(0)}</span>
                  </div>
                  <div className="fa-metric-reading mono">{m.reading}</div>
                  <div className="progress-bg">
                    <div className={`progress-fill ${scoreClass(m.score)}`} style={{ width: `${m.score}%` }} />
                  </div>
                  {ex && (
                    <div className="fa-explanation">
                      <div className="fa-explanation-title">{ex.title}</div>
                      <p>{ex.body}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> Equity/ETF closes (SPY, HYG, IEF, and the 11 S&amp;P sector SPDRs)
        come from Massive&apos;s Custom Bars endpoint. VIX and the U.S. Dollar Index aren&apos;t available
        on the current Stocks plan (they&apos;re billed under Massive&apos;s separate Indices line), so
        this model substitutes the free, public FRED series <code>VIXCLS</code> and{" "}
        <code>DTWEXBGS</code> (Nominal Broad U.S. Dollar Index) — close proxies, not identical tickers to
        the original. The yield curve uses FRED&apos;s <code>T10Y2Y</code> series. All scoring thresholds
        and formulas mirror the source model as closely as possible, including RSI-14&apos;s simple
        (non-Wilder) smoothing. This is a daily/positional model, not an intraday one; data refreshes
        hourly. Note: the source model&apos;s hardcoded economic-event calendar isn&apos;t reproduced here,
        since it was static sample data rather than a live feed.
      </p>
    </section>
  );
}
