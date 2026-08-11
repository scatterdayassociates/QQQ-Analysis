"use client";

import { useState, useEffect, useMemo } from "react";
import SmartMoneyControls from "./SmartMoneyControls";
import WeightSummary from "./WeightSummary";
import CompositeLeaderboard from "./CompositeLeaderboard";
import TickerDetailCard from "./TickerDetailCard";

export interface ScoreWeights {
  insider: number;
  activist: number;
  cot: number;
  short_interest: number;
  thirteenf: number;
}

export interface Score {
  ticker: string;
  composite_score: number;
  insider_cluster_score: number;
  activist_flag_score: number;
  cot_zscore: number;
  short_interest_momentum_score: number;
  thirteenf_conviction_score: number;
  as_of_date: string;
  weights_used?: ScoreWeights;
}

export interface DataFreshness {
  [key: string]: {
    last_update: string | null;
    age_days: number | null;
  };
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  insider: 25,
  activist: 15,
  cot: 20,
  short_interest: 15,
  thirteenf: 25,
};

export default function SmartMoneyPanel() {
  const [selectedUniverse, setSelectedUniverse] = useState<string>("Nasdaq-100");
  const [selectedFunds, setSelectedFunds] = useState<string[]>([
    "Citadel",
    "Millennium",
    "Point72",
  ]);
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<Score | null>(null);
  const [dataFreshness, setDataFreshness] = useState<DataFreshness | null>(null);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [isUsingMockData, setIsUsingMockData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Create stable dependency key to track changes
  const dependencyKey = useMemo(
    () => `${selectedUniverse}|${selectedFunds.join(",")}|${JSON.stringify(weights)}`,
    [selectedUniverse, selectedFunds, weights]
  );

  const fetchDataFreshness = async () => {
    try {
      const response = await fetch("/api/smart-money/scoring/data-freshness");
      if (response.ok) {
        const data = await response.json();
        setDataFreshness(data.data_freshness || {});
      }
    } catch (err) {
      console.warn("Could not fetch data freshness:", err);
    }
  };

  const fetchCacheStats = async () => {
    try {
      const response = await fetch("/api/smart-money/scoring/cache-stats");
      if (response.ok) {
        const data = await response.json();
        setCacheStats(data.cache_stats || {});
      }
    } catch (err) {
      console.warn("Could not fetch cache stats:", err);
    }
  };

  const fetchScores = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        universe: selectedUniverse,
        funds: selectedFunds.join(","),
        weights: JSON.stringify(weights),
      });
      const response = await fetch(`/api/smart-money/scores?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch scores: ${response.statusText}`);
      }
      const data = await response.json();
      setScores(data.scores || []);
      setIsUsingMockData(!!data.note);
      setLastUpdated(new Date().toLocaleTimeString());

      // Fetch freshness and cache stats in parallel
      await Promise.all([fetchDataFreshness(), fetchCacheStats()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Error fetching scores:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencyKey]);

  const handleWeightsUpdate = (newWeights: ScoreWeights) => {
    setWeights(newWeights);
  };

  const handleManualRefresh = () => {
    fetchScores();
  };

  // Get freshness indicator for a data source
  const getFreshnessIndicator = (sourceName: string) => {
    if (!dataFreshness || !dataFreshness[sourceName]) return null;
    const { age_days } = dataFreshness[sourceName];
    if (age_days === null) return "—";
    if (age_days === 0) return "✓ Fresh";
    if (age_days <= 7) return `✓ ${age_days}d`;
    if (age_days <= 30) return `⚠ ${age_days}d`;
    return `✗ ${age_days}d`;
  };

  return (
    <div className="smart-money-panel">
      <SmartMoneyControls
        selectedUniverse={selectedUniverse}
        onUniverseChange={setSelectedUniverse}
        selectedFunds={selectedFunds}
        onFundsChange={setSelectedFunds}
        weights={weights}
        onWeightsUpdate={handleWeightsUpdate}
      />

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-info">
          <div className="status-item">
            <span className="status-label">Last Updated:</span>
            <span className="status-value">
              {lastUpdated || "Not loaded"}
            </span>
          </div>

          {isUsingMockData && (
            <div className="status-item warning">
              <span className="status-label">⚠ Using Mock Data</span>
              <span className="status-value">Backend unavailable</span>
            </div>
          )}

          {!isUsingMockData && cacheStats?.cache_enabled && (
            <div className="status-item">
              <span className="status-label">Cache:</span>
              <span className="status-value">
                {cacheStats.valid_entries}/{cacheStats.total_entries} entries
              </span>
            </div>
          )}

          <div className="freshness-badges">
            <span className="freshness-label">Data Age:</span>
            {dataFreshness && (
              <>
                <span className="freshness-badge">{getFreshnessIndicator("form4")} Form 4</span>
                <span className="freshness-badge">{getFreshnessIndicator("filings_13d")} 13D</span>
                <span className="freshness-badge">{getFreshnessIndicator("cot")} COT</span>
                <span className="freshness-badge">{getFreshnessIndicator("short_interest")} Short Int</span>
                <span className="freshness-badge">{getFreshnessIndicator("thirteenf")} 13F</span>
              </>
            )}
          </div>
        </div>

        <button
          className="refresh-button"
          onClick={handleManualRefresh}
          disabled={loading}
          title="Manually refresh scores"
        >
          {loading ? "Loading..." : "🔄 Refresh"}
        </button>
      </div>

      <div className="smart-money-content">
        <div className="scores-section">
          {error && <div className="error-message">{error}</div>}

          {!error && (
            <>
              <WeightSummary weights={weights} />

              <CompositeLeaderboard
                scores={scores}
                loading={loading}
                selectedTicker={selectedTicker}
                onSelectTicker={setSelectedTicker}
              />
            </>
          )}
        </div>

        {selectedTicker && (
          <div className="detail-section">
            <TickerDetailCard score={selectedTicker} />
          </div>
        )}
      </div>

      <style jsx>{`
        .smart-money-panel {
          width: 100%;
        }

        .status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1.5rem;
          gap: 1.5rem;
        }

        .status-info {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          flex: 1;
          min-width: 0;
          flex-wrap: wrap;
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--text);
        }

        .status-item.warning {
          color: rgb(217, 119, 6);
          background: rgba(217, 119, 6, 0.1);
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
        }

        .status-label {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .status-value {
          color: var(--text);
          font-family: "Monaco", "Courier New", monospace;
        }

        .freshness-badges {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .freshness-label {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .freshness-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          background: rgba(100, 150, 255, 0.1);
          border: 1px solid rgba(100, 150, 255, 0.2);
          border-radius: 3px;
          color: var(--text);
          font-family: "Monaco", "Courier New", monospace;
        }

        .refresh-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--focus);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .refresh-button:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .refresh-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .smart-money-content {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 2rem;
          align-items: start;
        }

        .scores-section {
          flex: 1;
          min-width: 0;
        }

        .detail-section {
          width: 350px;
          position: sticky;
          top: 20px;
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          color: rgb(239, 68, 68);
          padding: 1rem;
          border-radius: 8px;
          border: 1px solid rgba(239, 68, 68, 0.2);
          margin-bottom: 1.5rem;
        }

        @media (max-width: 1200px) {
          .smart-money-content {
            grid-template-columns: 1fr;
          }

          .detail-section {
            width: 100%;
            position: static;
          }

          .status-bar {
            flex-direction: column;
            align-items: flex-start;
          }

          .status-info {
            width: 100%;
          }

          .refresh-button {
            width: 100%;
            justify-content: center;
          }
        }

        @media (max-width: 768px) {
          .status-bar {
            padding: 0.75rem;
            gap: 1rem;
          }

          .status-info {
            gap: 1rem;
          }

          .freshness-badges {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
