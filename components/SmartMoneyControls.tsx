"use client";

import { useState } from "react";
import type { ScoreWeights } from "./SmartMoneyPanel";

interface SmartMoneyControlsProps {
  selectedUniverse: string;
  onUniverseChange: (universe: string) => void;
  selectedFunds: string[];
  onFundsChange: (funds: string[]) => void;
  weights: ScoreWeights;
  onWeightsUpdate: (weights: ScoreWeights) => void;
}

const UNIVERSES = ["Nasdaq-100", "S&P 500", "Russell 2000"];
const AVAILABLE_FUNDS = [
  "Citadel",
  "Millennium",
  "Point72",
  "Balyasny",
];

export default function SmartMoneyControls({
  selectedUniverse,
  onUniverseChange,
  selectedFunds,
  onFundsChange,
  weights,
  onWeightsUpdate,
}: SmartMoneyControlsProps) {
  const [showWeightDialog, setShowWeightDialog] = useState(false);
  const [tempWeights, setTempWeights] = useState<ScoreWeights>(weights);

  const handleFundToggle = (fund: string) => {
    setSelectedFunds(
      selectedFunds.includes(fund)
        ? selectedFunds.filter((f) => f !== fund)
        : [...selectedFunds, fund]
    );
  };

  const handleWeightChange = (key: keyof ScoreWeights, value: string) => {
    const numValue = Math.max(0, Math.min(100, Number(value) || 0));
    setTempWeights((prev) => ({ ...prev, [key]: numValue }));
  };

  const handleApplyWeights = () => {
    // Validate that weights sum to reasonable value (e.g., 100 is default)
    const total = Object.values(tempWeights).reduce((a, b) => a + b, 0);
    if (total === 0) {
      alert("At least one weight must be non-zero");
      return;
    }
    onWeightsUpdate(tempWeights);
    setShowWeightDialog(false);
  };

  const handleReset = () => {
    setTempWeights(weights);
  };

  return (
    <div className="smart-money-controls">
      <div className="controls-row">
        <div className="control-group">
          <label>Universe</label>
          <select
            value={selectedUniverse}
            onChange={(e) => onUniverseChange(e.target.value)}
            className="select-input"
          >
            {UNIVERSES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Smart Money Funds</label>
          <div className="fund-checkboxes">
            {AVAILABLE_FUNDS.map((fund) => (
              <label key={fund} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedFunds.includes(fund)}
                  onChange={() => handleFundToggle(fund)}
                />
                <span>{fund}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="control-group">
          <button
            className="button-secondary"
            onClick={() => {
              setTempWeights(weights);
              setShowWeightDialog(true);
            }}
          >
            Adjust Weights
          </button>
        </div>
      </div>

      {showWeightDialog && (
        <div className="modal-overlay" onClick={() => setShowWeightDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Adjust Score Weights</h3>
              <button
                className="close-btn"
                onClick={() => setShowWeightDialog(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="weights-grid">
                <div className="weight-input-group">
                  <label>Insider Cluster (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempWeights.insider}
                    onChange={(e) =>
                      handleWeightChange("insider", e.target.value)
                    }
                  />
                </div>

                <div className="weight-input-group">
                  <label>Activist Flag (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempWeights.activist}
                    onChange={(e) =>
                      handleWeightChange("activist", e.target.value)
                    }
                  />
                </div>

                <div className="weight-input-group">
                  <label>COT Z-Score (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempWeights.cot}
                    onChange={(e) => handleWeightChange("cot", e.target.value)}
                  />
                </div>

                <div className="weight-input-group">
                  <label>Short Interest Momentum (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempWeights.short_interest}
                    onChange={(e) =>
                      handleWeightChange("short_interest", e.target.value)
                    }
                  />
                </div>

                <div className="weight-input-group">
                  <label>13F Conviction (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempWeights.thirteenf}
                    onChange={(e) =>
                      handleWeightChange("thirteenf", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="button-secondary"
                onClick={handleReset}
              >
                Reset
              </button>
              <button
                className="button-primary"
                onClick={handleApplyWeights}
              >
                Apply Weights
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .smart-money-controls {
          background: var(--surface);
          padding: 1rem;
          border-radius: var(--radius);
          margin-bottom: 1.5rem;
          border: 1px solid var(--border);
        }

        .controls-row {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .control-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .control-group label {
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .select-input {
          padding: 0.45rem 0.6rem;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: var(--surface-2);
          color: var(--text);
          font-size: 0.86rem;
          cursor: pointer;
          font-family: inherit;
        }

        .select-input:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 1px;
        }

        .fund-checkboxes {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.86rem;
          color: var(--text);
        }

        .checkbox-label input[type="checkbox"] {
          cursor: pointer;
        }

        .button-secondary {
          padding: 0.55rem 1.15rem;
          background: var(--surface-2);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 7px;
          font-size: 0.86rem;
          font-weight: 650;
          cursor: pointer;
          transition: filter 0.15s ease;
          font-family: inherit;
        }

        .button-secondary:hover {
          filter: brightness(1.08);
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: var(--surface);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem;
          border-bottom: 1px solid var(--border);
        }

        .modal-header h3 {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 650;
          color: var(--text);
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--muted);
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
        }

        .close-btn:hover {
          color: var(--text);
        }

        .close-btn:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 1px;
        }

        .modal-body {
          padding: 1.5rem;
        }

        .weights-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .weight-input-group {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .weight-input-group label {
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--muted-2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .weight-input-group input {
          padding: 0.45rem 0.6rem;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: var(--surface-2);
          color: var(--text);
          font-size: 0.86rem;
          font-family: inherit;
        }

        .weight-input-group input:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 1px;
        }

        .modal-footer {
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
          padding: 1.5rem;
          border-top: 1px solid var(--border);
        }

        .button-primary {
          padding: 0.55rem 1.15rem;
          background: var(--focus);
          color: #0b0e14;
          border: none;
          border-radius: 7px;
          font-size: 0.86rem;
          font-weight: 650;
          cursor: pointer;
          font-family: inherit;
          transition: filter 0.15s ease;
        }

        .button-primary:hover {
          filter: brightness(1.08);
        }

        .button-primary:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
