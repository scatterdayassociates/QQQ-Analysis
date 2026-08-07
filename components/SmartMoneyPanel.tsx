"use client";

import { useState, useEffect } from "react";
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
  }, [selectedUniverse, selectedFunds, weights]);

  const handleWeightsUpdate = (newWeights: ScoreWeights) => {
    setWeights(newWeights);
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
        }
      `}</style>
    </div>
  );
}
