"use client";

import type { ScoreWeights } from "./SmartMoneyPanel";

interface WeightSummaryProps {
  weights: ScoreWeights;
}

export default function WeightSummary({ weights }: WeightSummaryProps) {
  const weightEntries = [
    { key: "insider", label: "Insider Cluster" },
    { key: "activist", label: "Activist Flag" },
    { key: "cot", label: "COT Z-Score" },
    { key: "short_interest", label: "Short Interest" },
    { key: "thirteenf", label: "13F Conviction" },
  ] as const;

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const normalizedWeights = total > 0
    ? Object.fromEntries(
        Object.entries(weights).map(([k, v]) => [k, (v / total) * 100])
      )
    : weights;

  return (
    <div className="weight-summary">
      <div className="summary-title">Score Weights</div>
      <div className="weight-columns">
        {weightEntries.map(({ key, label }) => {
          const weight = weights[key as keyof ScoreWeights];
          const normalizedWeight =
            normalizedWeights[key as keyof typeof normalizedWeights] || 0;

          return (
            <div key={key} className="weight-column">
              <div className="weight-label">{label}</div>
              <div className="weight-value">{Math.round(normalizedWeight)}%</div>
              <div className="weight-bar">
                <div
                  className="weight-bar-fill"
                  style={{ width: `${normalizedWeight}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .weight-summary {
          background: var(--surface);
          padding: 1.25rem;
          border-radius: var(--radius);
          margin-bottom: 1.5rem;
          border: 1px solid var(--border);
        }

        .summary-title {
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 1rem;
        }

        .weight-columns {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 1.25rem;
        }

        .weight-column {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .weight-label {
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .weight-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          line-height: 1;
        }

        .weight-bar {
          width: 100%;
          height: 6px;
          background: var(--border);
          border-radius: 3px;
          overflow: hidden;
        }

        .weight-bar-fill {
          height: 100%;
          background: var(--focus);
          transition: width 0.3s ease;
        }
      `}</style>
    </div>
  );
}
