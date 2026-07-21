// Server-side fundamental/tactical scoring model. Replicates the 7-metric
// strength model and tactical decision logic from the source Streamlit
// script, adapted to TypeScript with two data-source substitutions:
//
//   - VIX and the U.S. Dollar Index are Massive "Indices"-tier tickers,
//     which this account's Stocks plan doesn't include. Both are swapped
//     for free, public FRED series (VIXCLS and DTWEXBGS) instead of
//     requiring another subscription.
//   - The hardcoded "Red Folder" economic-event calendar from the source
//     script is not reproduced (it was static Jan-2025 sample data, not a
//     live feed, and there's no data source wired up here to keep one).
//
// This file must only ever be imported from server code, since equity data
// goes through lib/massive.ts (which reads the secret MASSIVE_API_KEY).

import { getCustomBars } from "./massive";

const SECTOR_TICKERS = [
  "XLY",
  "XLP",
  "XLE",
  "XLF",
  "XLV",
  "XLI",
  "XLB",
  "XLK",
  "XLU",
  "XLC",
  "XLRE",
] as const;

// Calendar-day lookback wide enough to guarantee 200+ trading days for the
// longest rolling window used (SPY / sector 200-day moving averages).
const LOOKBACK_DAYS = 420;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchDailyCloses(ticker: string, from: string, to: string): Promise<number[]> {
  const bars = await getCustomBars(ticker, { multiplier: 1, timespan: "day", from, to });
  return bars.map((b) => b.c);
}

async function fetchFredSeries(seriesId: string): Promise<number[]> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: HTTP ${res.status}`);
  }
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // drop header row

  const values: number[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    const raw = parts[1];
    if (raw === undefined || raw === ".") continue; // FRED's own "missing" marker
    const v = Number.parseFloat(raw);
    if (!Number.isNaN(v)) values.push(v);
  }
  if (values.length === 0) {
    throw new Error(`FRED series ${seriesId} returned no usable data.`);
  }
  return values;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStdDev(xs: number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function rollingMeanLast(xs: number[], window: number): number | null {
  if (xs.length < window) return null;
  return mean(xs.slice(xs.length - window));
}

function rollingStdLast(xs: number[], window: number): number | null {
  if (xs.length < window) return null;
  return sampleStdDev(xs.slice(xs.length - window));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// RSI-14 using a simple rolling average of gains/losses (matching the
// source script exactly) rather than Wilder's exponential smoothing, which
// most charting platforms use — the value here may read slightly
// differently than a typical chart's RSI as a result.
function rsiLast(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));
  const avgGain = mean(gains.slice(gains.length - period));
  const avgLoss = mean(losses.slice(losses.length - period));
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Simplified TD Sequential-style exhaustion count: compare each close to
// the close 4 trading days earlier, and tally the current run of
// consecutive same-direction readings (capped conceptually at 9, DeMark's
// classic exhaustion threshold).
function exhaustionCount(closes: number[]): { lastUp: boolean; count: number } {
  const dm: boolean[] = [];
  for (let i = 4; i < closes.length; i++) dm.push(closes[i] > closes[i - 4]);
  const lastUp = dm[dm.length - 1];
  let count = 0;
  for (let i = dm.length - 1; i >= 0; i--) {
    if (dm[i] === lastUp) count += 1;
    else break;
  }
  return { lastUp, count };
}

export interface FundamentalMetric {
  key: string;
  label: string;
  reading: string;
  score: number; // 0-100
}

export interface FundamentalAnalysis {
  asOf: string;
  action: "NO TRADE" | "SELL PREMIUM" | "WAIT";
  allocationPct: number;
  averageScore: number;
  triggers: {
    downtrend: boolean;
    environmentOk: boolean;
    volatilitySpike: boolean;
  };
  metrics: FundamentalMetric[];
}

export async function getFundamentalAnalysis(): Promise<FundamentalAnalysis> {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - LOOKBACK_DAYS);
  const fromStr = toDateStr(from);
  const toStr = toDateStr(today);

  const equityTickers = ["SPY", "HYG", "IEF", ...SECTOR_TICKERS];

  const [equityCloses, yieldCurveSeries, vixSeries, dollarSeries] = await Promise.all([
    Promise.all(equityTickers.map((t) => fetchDailyCloses(t, fromStr, toStr))),
    fetchFredSeries("T10Y2Y"),
    fetchFredSeries("VIXCLS"),
    fetchFredSeries("DTWEXBGS"),
  ]);

  const closesByTicker: Record<string, number[]> = {};
  equityTickers.forEach((t, i) => {
    closesByTicker[t] = equityCloses[i];
  });

  const spy = closesByTicker["SPY"];
  const hyg = closesByTicker["HYG"];
  const ief = closesByTicker["IEF"];

  if (spy.length === 0 || hyg.length === 0 || ief.length === 0) {
    throw new Error("Missing equity data from Massive for SPY/HYG/IEF.");
  }

  const spyPx = spy[spy.length - 1];
  const spy200ma = rollingMeanLast(spy, 200);
  if (spy200ma === null) {
    throw new Error("Not enough SPY history for a 200-day moving average.");
  }
  const distTo200 = (spyPx - spy200ma) / spy200ma;
  const downtrend = distTo200 <= -0.02;
  const neutralTrend = !downtrend;

  const hygPx = hyg[hyg.length - 1];
  const hyg20ma = rollingMeanLast(hyg, 20) ?? hygPx;
  const dxyPx = dollarSeries[dollarSeries.length - 1];
  const dxy20High = Math.max(...dollarSeries.slice(-20));
  const environmentOk = neutralTrend && hygPx >= hyg20ma && dxyPx < dxy20High;

  const vixPx = vixSeries[vixSeries.length - 1];
  const vixPrev = vixSeries[vixSeries.length - 2] ?? vixPx;
  const vixChange = vixPrev !== 0 ? (vixPx - vixPrev) / vixPrev : 0;
  const vix20ma = rollingMeanLast(vixSeries, 20) ?? vixPx;
  const vix20std = rollingStdLast(vixSeries, 20) || 1;
  const vixZScore = (vixPx - vix20ma) / vix20std;
  const volatilitySpike = vixChange > 0.08 && vixZScore > 1.5;

  let action: FundamentalAnalysis["action"];
  if (downtrend) action = "NO TRADE";
  else if (environmentOk && volatilitySpike) action = "SELL PREMIUM";
  else action = "WAIT";

  // --- 7-metric scoring ---

  const trendScore = clamp(50 + distTo200 * 1000, 0, 100);

  const ratioLen = Math.min(hyg.length, ief.length);
  const ratio = Array.from(
    { length: ratioLen },
    (_, i) => hyg[hyg.length - ratioLen + i] / ief[ief.length - ratioLen + i]
  );
  const ratioLast = ratio[ratio.length - 1];
  const ratio50ma = rollingMeanLast(ratio, 50) ?? ratioLast;
  const ratioDeltaPct = (ratioLast / ratio50ma - 1) * 100;
  const creditScore = clamp(50 + ratioDeltaPct * 20, 0, 100);

  const above200 = SECTOR_TICKERS.filter((t) => {
    const closes = closesByTicker[t];
    const ma = rollingMeanLast(closes, 200);
    return ma !== null && closes[closes.length - 1] > ma;
  }).length;
  const breadthScore = (above200 / SECTOR_TICKERS.length) * 100;

  const volScore = clamp((vixZScore + 2) * 25, 0, 100);

  const rsiVal = rsiLast(spy, 14) ?? 50;
  const rsiScore = 100 - rsiVal;

  const { lastUp, count } = exhaustionCount(spy);
  const exhaustionScore = lastUp ? 100 - (count / 9) * 100 : (count / 9) * 100;

  const yieldCurr = yieldCurveSeries[yieldCurveSeries.length - 1];
  const wasInverted = yieldCurveSeries.slice(-180).some((v) => v < 0);
  let yieldScore: number;
  if (yieldCurr > 0 && wasInverted) yieldScore = 10;
  else if (yieldCurr < 0) yieldScore = 40 + (yieldCurr + 1.0) * 20;
  else yieldScore = Math.min(100, 60 + yieldCurr * 50);

  const scores = [yieldScore, trendScore, creditScore, breadthScore, volScore, rsiScore, exhaustionScore];
  const averageScore = mean(scores);
  const allocationPct = averageScore >= 80 ? 100 : averageScore >= 60 ? 75 : averageScore >= 40 ? 50 : 20;

  const metrics: FundamentalMetric[] = [
    {
      key: "yield",
      label: "Macro: Yield Curve",
      reading: `${yieldCurr.toFixed(2)}% spread`,
      score: yieldScore,
    },
    {
      key: "trend",
      label: "Trend: 200-Day MA Proximity",
      reading: `${distTo200 >= 0 ? "+" : ""}${(distTo200 * 100).toFixed(2)}% vs 200MA`,
      score: trendScore,
    },
    {
      key: "credit",
      label: "Credit: Risk Ratio",
      reading: `HYG/IEF ${ratioDeltaPct >= 0 ? "+" : ""}${ratioDeltaPct.toFixed(2)}% vs 50D avg`,
      score: creditScore,
    },
    {
      key: "breadth",
      label: "Breadth: Sectors",
      reading: `${above200}/${SECTOR_TICKERS.length} above 200MA`,
      score: breadthScore,
    },
    {
      key: "vix",
      label: "Tactical: VIX Z-Score",
      reading: `Z: ${vixZScore.toFixed(2)}`,
      score: volScore,
    },
    {
      key: "rsi",
      label: "Tactical: RSI-14",
      reading: `RSI: ${rsiVal.toFixed(1)}`,
      score: rsiScore,
    },
    {
      key: "exhaustion",
      label: "Tactical: Exhaustion Count",
      reading: `${lastUp ? "Up" : "Down"} streak, step ${count}/9`,
      score: exhaustionScore,
    },
  ];

  return {
    asOf: toStr,
    action,
    allocationPct,
    averageScore,
    triggers: { downtrend, environmentOk, volatilitySpike },
    metrics,
  };
}
