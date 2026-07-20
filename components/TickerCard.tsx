"use client";

import type { TickerDashboardData } from "@/lib/massive";
import VolumeChart from "./VolumeChart";

function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function pctClass(pct: number | null): string {
  if (pct === null) return "flat";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

function formatVolume(v: number | undefined): string {
  if (!v) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
}

export default function TickerCard({ data }: { data: TickerDashboardData }) {
  const { ticker, latest, bars, dayOverDayChangePct, dayOverLastWeekChangePct } = data;

  return (
    <div className="card">
      <div className="card-title-row">
        <h2>{ticker}</h2>
        {latest && <span className="meta-row">{latest.from}</span>}
      </div>

      <div className="close-price">{latest ? `$${latest.close.toFixed(2)}` : "—"}</div>

      <div className="stat-row">
        <div className="stat">
          <span className="label">Day over Day</span>
          <span className={`value pct ${pctClass(dayOverDayChangePct)}`}>
            {formatPct(dayOverDayChangePct)}
          </span>
        </div>
        <div className="stat">
          <span className="label">Day over Last Week</span>
          <span className={`value pct ${pctClass(dayOverLastWeekChangePct)}`}>
            {formatPct(dayOverLastWeekChangePct)}
          </span>
        </div>
        <div className="stat">
          <span className="label">Volume</span>
          <span className="value">{formatVolume(latest?.volume)}</span>
        </div>
      </div>

      <div className="chart-wrap">
        <div className="chart-label">30-Day Volume (Custom Bars)</div>
        <VolumeChart bars={bars} />
      </div>
    </div>
  );
}
