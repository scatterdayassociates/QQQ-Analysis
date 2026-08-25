// Client-safe types shared between the 0DTE Scanner API routes and the tab UI.
// No secrets, no server imports — safe to import from client components.

export type GateStateValue = "TRADE" | "NO_TRADE";

export interface GateCondition {
  id: string; // "G1".."G7"
  name: string;
  pass: boolean;
  /** Human-readable current value, e.g. "cheapness 1.07" */
  value: string;
  /** Human-readable threshold, e.g. "need < 0.85" */
  threshold: string;
  note?: string;
}

export interface GateState {
  state: GateStateValue;
  conditions: GateCondition[];
  /** ISO timestamp of the evaluation pass (server clock) */
  evaluatedAt: string;
  /** Explicit stand-down guidance per spec §7.4, when applicable */
  recommendation: string | null;
}

export interface ImSeriesPoint {
  etTime: string; // "HH:MM" ET
  spot: number | null;
  imRemaining: number | null; // % of spot, e.g. 0.0085 = 0.85%
  cemRemaining: number | null;
  cheapness: number | null;
}

export interface OdteContext {
  gexTotal: number | null; // $ per 1% move
  gexFlipStrike: number | null;
  ivTermRatio: number | null; // ATM_IV_0DTE / ATM_IV_~7DTE
  regime: string | null; // yield-curve regime label from the TBill tab
  catalyst: string | null; // 'FOMC' | 'CPI' | 'NFP' | 'OPEX' | null
  imPercentile: number | null; // opening IM vs recorded history (null until enough sessions)
  imPercentileSessions: number; // how many prior sessions the percentile is based on
}

export interface OdteSessionSummary {
  tradeDate: string; // YYYY-MM-DD
  underlying: string;
  spotOpen: number | null;
  spot: number | null; // latest observed spot (T-15)
  impliedMoveOpen: number | null;
  orRange: number | null;
  expiry0dteAvailable: boolean;
  weeklyExpiry: string | null;
}

export interface OdteStatus {
  session: OdteSessionSummary | null;
  gate: GateState | null;
  series: ImSeriesPoint[];
  context: OdteContext | null;
  riskBudget: {
    totalUsd: number;
    usedUsd: number;
  };
  /** Newest API-derived data timestamp, ISO — the "data as of" stamp. */
  dataAsOf: string | null;
  /** Minutes between now and dataAsOf (staleness), null when unknown. */
  dataAgeMinutes: number | null;
  /** True outside regular trading hours / weekends. */
  marketClosed: boolean;
  error?: string;
}
