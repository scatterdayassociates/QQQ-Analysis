"use client";

import type { Score, DataFreshness } from "./SmartMoneyPanel";

interface TickerDetailCardProps {
  score: Score;
  dataFreshness?: DataFreshness | null;
}

export default function TickerDetailCard({
  score,
  dataFreshness,
}: TickerDetailCardProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get freshness indicator for a specific data source
  const getFreshnessLabel = (sourceName: string): string => {
    if (!dataFreshness || !dataFreshness[sourceName]) return "—";
    const { last_update, age_days } = dataFreshness[sourceName];
    if (!last_update || age_days === null) return "—";
    return `as of ${last_update}`;
  };

  // 2x2 grid of 4 main panels as per brief
  const chartPanels = [
    {
      key: "insider",
      title: "Insider Cluster Buys, Trailing 90d",
      value: score.insider_cluster_score,
      sourceKey: "form4",
    },
    {
      key: "cot",
      title: "COT Leveraged Fund Net Position, Z-Score",
      value: score.cot_zscore,
      sourceKey: "cot",
    },
    {
      key: "short",
      title: "Short Interest & Days-to-Cover",
      value: score.short_interest_momentum_score,
      sourceKey: "short_interest",
    },
    {
      key: "thirteenf",
      title: "13F Fund Position Deltas",
      value: score.thirteenf_conviction_score,
      sourceKey: "thirteenf",
    },
  ];

  return (
    <div className="ticker-detail-card">
      <div className="detail-header">
        <div className="detail-title">
          <span className="ticker-name">{score.ticker}</span>
          <span className="detail-subtitle">detail</span>
        </div>
        <div className="detail-meta">
          <div className="composite-badge">
            Composite{" "}
            <span className="badge-value">
              {Math.round(score.composite_score || 0)}
            </span>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        {chartPanels.map((panel) => (
          <div key={panel.key} className="chart-panel">
            <div className="panel-header">
              <h4>{panel.title}</h4>
              <span className="panel-freshness">
                {getFreshnessLabel(panel.sourceKey)}
              </span>
            </div>
            <div className="panel-content">
              <div className="score-display">
                {panel.value !== undefined && panel.value !== null ? (
                  <>
                    <div className="large-number">
                      {Math.round(panel.value)}
                    </div>
                    <div className="score-bar">
                      <div
                        className="score-bar-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, panel.value)
                          )}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="no-data">No data</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="methodology">
        <p>
          <strong>Methodology:</strong> This is positioning and futures-positioning
          data, not price/volume data. Data has variable filing lags per source:
          Form 4 ~T+2 days, 13D ~T+10 days, COT weekly, short interest biweekly,
          13F ~T+45 days. A large 13F position does not necessarily indicate
          directional conviction. The composite score is probabilistic, not a
          recommendation.
        </p>
      </div>

      <style jsx>{`
        .ticker-detail-card {
          background: var(--surface);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          overflow: hidden;
        }

        .detail-header {
          padding: 1.25rem;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .detail-title {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
        }

        .ticker-name {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          line-height: 1;
        }

        .detail-subtitle {
          font-size: 0.75rem;
          color: var(--muted);
          font-weight: 400;
          text-transform: lowercase;
        }

        .detail-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
          font-size: 0.7rem;
        }

        .composite-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.7rem;
          background: var(--surface-2);
          border-radius: 5px;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border: 1px solid var(--border);
        }

        .badge-value {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--focus);
        }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.8rem;
          padding: 1.25rem;
        }

        .chart-panel {
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 7px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .panel-header {
          padding: 0.8rem;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }

        .panel-header h4 {
          margin: 0;
          font-size: 0.65rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          line-height: 1.2;
        }

        .panel-freshness {
          font-size: 0.6rem;
          color: var(--muted);
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
        }

        .panel-content {
          flex: 1;
          padding: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 120px;
        }

        .score-display {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
        }

        .large-number {
          font-size: 1.8rem;
          font-weight: 700;
          color: var(--text);
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .score-bar {
          width: 100%;
          height: 5px;
          background: var(--border);
          border-radius: 2.5px;
          overflow: hidden;
        }

        .score-bar-fill {
          height: 100%;
          background: var(--focus);
          transition: width 0.3s ease;
        }

        .no-data {
          font-size: 0.8rem;
          color: var(--muted);
          text-align: center;
        }

        .methodology {
          padding: 1rem 1.25rem;
          border-top: 1px solid var(--border);
          background: var(--surface);
          font-size: 0.7rem;
          line-height: 1.4;
          color: var(--text-secondary);
        }

        .methodology p {
          margin: 0;
        }

        .methodology strong {
          color: var(--text);
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .charts-grid {
            grid-template-columns: 1fr;
            gap: 0.6rem;
            padding: 1rem;
          }

          .panel-header {
            padding: 0.6rem;
          }

          .panel-header h4 {
            font-size: 0.6rem;
          }
        }
      `}</style>
    </div>
  );
}
