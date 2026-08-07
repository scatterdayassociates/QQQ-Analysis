"use client";

import { useState, useMemo } from "react";
import type { Score } from "./SmartMoneyPanel";

interface CompositeLeaderboardProps {
  scores: Score[];
  loading: boolean;
  selectedTicker: Score | null;
  onSelectTicker: (score: Score | null) => void;
}

type SortField =
  | "composite_score"
  | "insider_cluster_score"
  | "activist_flag_score"
  | "cot_zscore"
  | "short_interest_momentum_score"
  | "thirteenf_conviction_score";

export default function CompositeLeaderboard({
  scores,
  loading,
  selectedTicker,
  onSelectTicker,
}: CompositeLeaderboardProps) {
  const [sortField, setSortField] = useState<SortField>("composite_score");
  const [sortAsc, setSortAsc] = useState(false);

  const sortedScores = useMemo(() => {
    const sorted = [...scores].sort((a, b) => {
      const aVal = a[sortField] ?? -Infinity;
      const bVal = b[sortField] ?? -Infinity;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [scores, sortField, sortAsc]);

  const getScorePill = (value: number | undefined) => {
    if (value === undefined || value === null) return "—";

    let color = "neutral";
    if (value >= 70) color = "good";
    else if (value >= 40) color = "warn";
    else color = "bad";

    return (
      <span className={`score-pill ${color}`}>{Math.round(value)}</span>
    );
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (loading) {
    return (
      <div className="composite-leaderboard loading">
        <div className="loading-message">Loading scores...</div>
      </div>
    );
  }

  if (scores.length === 0) {
    return (
      <div className="composite-leaderboard empty">
        <div className="empty-message">No scores available</div>
      </div>
    );
  }

  return (
    <div className="composite-leaderboard">
      <div className="leaderboard-header">Composite Rankings</div>

      <div className="table-wrapper">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="col-ticker">Ticker</th>
              <th
                className="col-sortable"
                onClick={() => handleSort("composite_score")}
              >
                <span>Composite</span>
                {sortField === "composite_score" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className="col-sortable"
                onClick={() => handleSort("insider_cluster_score")}
              >
                <span>Insider</span>
                {sortField === "insider_cluster_score" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className="col-sortable"
                onClick={() => handleSort("activist_flag_score")}
              >
                <span>Activist</span>
                {sortField === "activist_flag_score" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className="col-sortable"
                onClick={() => handleSort("cot_zscore")}
              >
                <span>COT</span>
                {sortField === "cot_zscore" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className="col-sortable"
                onClick={() =>
                  handleSort("short_interest_momentum_score")
                }
              >
                <span>Short Int.</span>
                {sortField === "short_interest_momentum_score" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className="col-sortable"
                onClick={() => handleSort("thirteenf_conviction_score")}
              >
                <span>13F</span>
                {sortField === "thirteenf_conviction_score" && (
                  <span className="sort-indicator">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedScores.map((score) => (
              <tr
                key={score.ticker}
                className={`score-row${
                  selectedTicker?.ticker === score.ticker ? " selected" : ""
                }`}
                onClick={() =>
                  onSelectTicker(
                    selectedTicker?.ticker === score.ticker ? null : score
                  )
                }
              >
                <td className="col-ticker">
                  <span className="ticker-label">{score.ticker}</span>
                </td>
                <td className="col-score">
                  {getScorePill(score.composite_score)}
                </td>
                <td className="col-score">
                  {getScorePill(score.insider_cluster_score)}
                </td>
                <td className="col-score">
                  {getScorePill(score.activist_flag_score)}
                </td>
                <td className="col-score">
                  {getScorePill(score.cot_zscore)}
                </td>
                <td className="col-score">
                  {getScorePill(score.short_interest_momentum_score)}
                </td>
                <td className="col-score">
                  {getScorePill(score.thirteenf_conviction_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .composite-leaderboard {
          background: var(--surface);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          overflow: hidden;
        }

        .composite-leaderboard.loading,
        .composite-leaderboard.empty {
          padding: 2rem;
          text-align: center;
          color: var(--muted);
        }

        .loading-message,
        .empty-message {
          font-size: 0.86rem;
        }

        .leaderboard-header {
          padding: 1rem 1.15rem;
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
        }

        .table-wrapper {
          overflow-x: auto;
        }

        .leaderboard-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.86rem;
        }

        .leaderboard-table thead {
          background: var(--surface-2);
          border-bottom: 1px solid var(--border);
        }

        .leaderboard-table th {
          padding: 0.75rem 1rem;
          text-align: left;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          user-select: none;
        }

        .col-sortable {
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .col-sortable:hover {
          background: var(--surface);
        }

        .col-sortable span {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }

        .sort-indicator {
          font-size: 0.7rem;
          color: var(--focus);
        }

        .leaderboard-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border);
          color: var(--text);
        }

        .score-row {
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .score-row:hover {
          background: var(--surface-2);
        }

        .score-row.selected {
          background: var(--surface-2);
          border-left: 3px solid var(--focus);
          padding-left: calc(1rem - 3px);
        }

        .col-ticker {
          font-weight: 650;
          width: 80px;
        }

        .ticker-label {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          background: var(--surface-2);
          border-radius: 4px;
          font-weight: 700;
          font-size: 0.8rem;
          border: 1px solid var(--border);
        }

        .col-score {
          text-align: center;
          width: 70px;
          font-variant-numeric: tabular-nums;
        }

        .score-pill {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 5px;
          font-weight: 600;
          font-size: 0.7rem;
          min-width: 35px;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }

        .score-pill.good {
          background: rgba(62, 207, 142, 0.15);
          color: var(--up);
          border: 1px solid rgba(62, 207, 142, 0.3);
        }

        .score-pill.warn {
          background: rgba(232, 162, 61, 0.15);
          color: var(--accent-vol);
          border: 1px solid rgba(232, 162, 61, 0.3);
        }

        .score-pill.bad {
          background: rgba(239, 68, 68, 0.15);
          color: var(--down);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .score-pill.neutral {
          background: var(--border);
          color: var(--muted);
          border: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
