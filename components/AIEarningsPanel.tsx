"use client";

import { useCallback, useEffect, useState } from "react";
import { AI_EARNINGS_UNIVERSE } from "@/lib/aiEarnings";
import type { AiEarningsData, AiEarningsScore, OptionsRichness } from "@/lib/aiEarnings";

const TIER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Hyperscaler",
  2: "Leveraged Buyer",
  3: "Credit-Risk Tail",
  4: "Memory Makers",
};

// Column-header tooltips (native title attribute) for the Buyer Fragility
// Score table — mirrors the footnote below, just surfaced inline per column
// so the definition is available without scrolling down.
const COLUMN_TOOLTIPS: Record<string, string> = {
  ticker: "Exchange ticker symbol.",
  tier:
    "Buyer-funding-posture cohort: Tier 1 Hyperscaler (funding capex mostly from operations, so far), " +
    "Tier 2 Leveraged Buyer (increasingly using debt/equity issuance), Tier 3 Credit-Risk Tail " +
    "(highest-beta/credit-risk name most exposed if the cycle cracks), Tier 4 Memory Makers " +
    "(AI-capex memory/storage suppliers, not buyers — a related but distinct cohort).",
  evToEbitda:
    "EV/EBITDA = Enterprise Value ÷ EBITDA (earnings before interest, taxes, depreciation & amortization). " +
    "Capital-structure-neutral valuation multiple — accounts for debt/cash on the balance sheet, unlike P/E — " +
    "comparable across this universe's very different leverage profiles. “—” if EBITDA is negative or unavailable.",
  latestQuarter: "Fiscal quarter end date (MM/DD/YYYY) the row's metrics are computed from.",
  coverage: "Coverage = operating cash flow ÷ capex, latest quarter. Below 1.0x means capex wasn't covered by operations that quarter.",
  capexToRevenue: "Capex/Rev = capex ÷ revenue, trailing 4-quarter average (smooths out lumpy one-off capex timing).",
  financing:
    "Financing = (debt issued + equity issued) ÷ capex, trailing 4-quarter average — how much of capex is funded " +
    "externally rather than from operations. Trailing-average rather than latest-quarter-only so a single one-off raise " +
    "doesn't outrank a name that's been persistently externally-funding capex for years.",
  trend: "Trend = latest capex coverage ratio minus the same quarter one year ago. Negative means deteriorating coverage.",
  buybackDelta: "Buyback Δ YoY = buybacks this quarter minus buybacks a year ago. A sharp cut is often the first lever pulled before touching the capex plan.",
  interestExpense: "Interest Exp YoY = year-over-year % growth in interest expense — rising debt service cost, a lagging fragility signal.",
  fragilityScore:
    "Fragility Score = cross-sectional z-scored composite of capex coverage (inverted), Capex/Rev, Financing, and Trend, " +
    "weighted 30/20/30/20. Computed across the entire universe (all tiers together), recalibrates automatically as tickers " +
    "are added. Higher = more fragile.",
};

function richnessClass(v: number | null): string {
  if (v === null) return "";
  return v >= 1 ? "up" : "down"; // >=1 = options pricing a bigger move than history — highlighted, not good/bad
}

function fmtRatio(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtEvToEbitda(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}x`;
}

// Alpha Vantage's fiscalDateEnding comes back "YYYY-MM-DD" — reformatted to
// MM/DD/YYYY for display per this table's date convention.
function fmtDate(v: string): string {
  const parts = v.split("-");
  if (parts.length !== 3) return v || "—";
  const [y, m, d] = parts;
  return `${m}/${d}/${y}`;
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
  const [expiration, setExpiration] = useState("");

  const load = useCallback(async (expirationParam: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = expirationParam
        ? `/api/ai-earnings?expiration=${encodeURIComponent(expirationParam)}`
        : "/api/ai-earnings";
      const res = await fetch(url);
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
    load(expiration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <button className="apply" onClick={() => load(expiration)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="ai-earnings-expiration">Options expiration (optional)</label>
          <input
            id="ai-earnings-expiration"
            type="date"
            className="mono"
            value={expiration}
            onChange={(e) => setExpiration(e.target.value)}
          />
        </div>
        <button className="apply" onClick={() => load(expiration)} disabled={loading}>
          Load Options Richness
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
                  <th title={COLUMN_TOOLTIPS.ticker}>Ticker</th>
                  <th title={COLUMN_TOOLTIPS.tier}>Tier</th>
                  <th title={COLUMN_TOOLTIPS.evToEbitda}>EV/EBITDA</th>
                  <th title={COLUMN_TOOLTIPS.latestQuarter}>Latest Qtr</th>
                  <th title={COLUMN_TOOLTIPS.coverage}>Coverage</th>
                  <th title={COLUMN_TOOLTIPS.capexToRevenue}>Capex/Rev</th>
                  <th title={COLUMN_TOOLTIPS.financing}>Financing</th>
                  <th title={COLUMN_TOOLTIPS.trend}>Trend</th>
                  <th title={COLUMN_TOOLTIPS.buybackDelta}>Buyback Δ YoY</th>
                  <th title={COLUMN_TOOLTIPS.interestExpense}>Interest Exp YoY</th>
                  <th title={COLUMN_TOOLTIPS.fragilityScore}>Fragility Score</th>
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
                    <td>{fmtEvToEbitda(s.evToEbitda)}</td>
                    <td>{fmtDate(s.latestQuarter)}</td>
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
              </tbody>
            </table>
          </div>
          {data.diagnostics && data.diagnostics.length > 0 && (
            <details className="table-accordion">
              <summary>
                Fetch diagnostics ({data.diagnostics.length}) — why a row above shows &ldquo;—&rdquo; for some columns
              </summary>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {data.diagnostics.slice(0, 24).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {data?.optionsRichness && (
        <div className="card">
          <div className="chart-label">Options Richness vs. Historical Earnings Moves ({expiration})</div>
          <div className="table-wrap">
            <table className="mono">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Spot</th>
                  <th>ATM Strike</th>
                  <th>Straddle</th>
                  <th>Implied Move</th>
                  <th>Avg Realized |Move|</th>
                  <th># Reports</th>
                  <th>Richness</th>
                </tr>
              </thead>
              <tbody>
                {data.optionsRichness.map((r: OptionsRichness) => (
                  <tr key={r.ticker}>
                    <td>{r.ticker}</td>
                    <td>{r.straddle ? `$${r.straddle.spotPrice.toFixed(2)}` : "—"}</td>
                    <td>{r.straddle ? `$${r.straddle.atmStrike.toFixed(2)}` : "—"}</td>
                    <td>{r.straddle?.straddlePrice != null ? `$${r.straddle.straddlePrice.toFixed(2)}` : "—"}</td>
                    <td>{fmtPct(r.straddle?.impliedMovePct ?? null)}</td>
                    <td>{fmtPct(r.avgRealizedAbsMovePct)}</td>
                    <td>{r.historicalMoveCount}</td>
                    <td className={richnessClass(r.richnessRatio)}>{fmtRatio(r.richnessRatio)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="footnote">
            <p>
              <strong>Options Richness.</strong> Pulled live from Massive&apos;s Options Chain Snapshot
              (<code>/v3/snapshot/options/&#123;ticker&#125;</code>, requires a Massive Options-tier
              subscription) using the strike closest to spot for the chosen expiration.
            </p>
            <p>
              <strong>Implied Move</strong> = (ATM call + ATM put <code>day.close</code>) ÷ spot price
              — the options market&apos;s straddle-implied move by that expiration; the live snapshot
              has no <code>last_quote</code>/bid-ask field, so <code>day.close</code> (last traded
              price) is the only price used.
            </p>
            <p>
              <strong>Avg Realized |Move|</strong> = average absolute close-to-close move on this
              ticker&apos;s own trailing 12 quarters of historical earnings report dates (Alpha
              Vantage <code>EARNINGS</code> + Massive daily bars).
            </p>
            <p>
              <strong>Richness</strong> = Implied Move ÷ Avg Realized |Move| — above 1.0x means the
              market is pricing in a bigger move than this ticker has historically delivered on
              earnings.
            </p>
          </div>
        </div>
      )}

      <div className="footnote">
        <p>
          <strong>Methodology.</strong> Screens a fixed universe (Alphabet, Microsoft, Meta, Amazon,
          Oracle, CoreWeave, SK Hynix, Micron, Sandisk) tiered by capex-funding posture — Tier 1
          hyperscalers still funding mostly from operations (so far), Tier 2 leveraged buyers
          increasingly using debt/equity issuance, Tier 3 the highest-beta/credit-risk names most
          exposed if the cycle cracks, Tier 4 Memory Makers — the AI-capex memory/storage
          <em> suppliers</em> rather than buyers, included as a related but distinct cohort (same
          fragility metrics, not force-fit into the buyer-side tiers above). All figures come from
          Alpha Vantage&apos;s <code>CASH_FLOW</code> and <code>INCOME_STATEMENT</code> endpoints
          (same <code>ALPHA_VANTAGE_API_KEY</code> used elsewhere in this app) — 2 requests per
          ticker, 18 total per load (27 with EV/EBITDA below), cached 24 hours since quarterly
          fundamentals only change 4x/year. Every ticker in the universe always gets a row —
          a rate-limited or missing fetch leaves that ticker&apos;s affected columns as “—” instead
          of dropping the row, so the table is always exactly {AI_EARNINGS_UNIVERSE.length} rows
          regardless of how many Alpha Vantage requests happened to clear the rate limit on a
          given load (see the fetch diagnostics disclosure above the table when that happens). The
          Fragility Score is cross-sectional across the
          <em> entire</em> universe (all four tiers together, not scored separately per tier) —
          adding Tier 4 shifts the comparison pool for every ticker&apos;s z-score, same as any
          universe change would.
        </p>
        <p>
          <strong>EV/EBITDA</strong> comes from Alpha Vantage&apos;s <code>OVERVIEW</code> endpoint
          (one more request per ticker, same key) — a capital-structure-neutral valuation reference
          alongside the fragility metrics, not itself part of the Fragility Score. Shows “—” when
          EBITDA is negative or unavailable.
        </p>
        <p>
          <strong>Coverage</strong> = operating cash flow ÷ capex, latest quarter (below 1.0x means
          capex wasn&apos;t covered by operations that quarter).
        </p>
        <p>
          <strong>Capex/Rev</strong> and <strong>Financing</strong> (debt + equity issued ÷ capex)
          use trailing 4-quarter averages rather than latest-quarter-only, so a single one-off raise
          (like a large one-time equity issuance) doesn&apos;t outrank a name that has been
          persistently externally-funding capex for years.
        </p>
        <p>
          <strong>Trend</strong> = latest coverage ratio minus the same quarter last year (negative =
          deteriorating).
        </p>
        <p>
          <strong>Buyback Δ YoY</strong> = buybacks this quarter minus a year ago — a sharp cut is
          often the first lever management pulls before touching the capex plan.
        </p>
        <p>
          <strong>Fragility Score</strong> combines all of the above into one cross-sectional
          z-scored composite (recalibrates automatically as tickers are added) — higher means more
          fragile.
        </p>
      </div>
    </section>
  );
}
