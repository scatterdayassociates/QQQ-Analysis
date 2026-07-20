"use client";

import type { CustomBar } from "@/lib/massive";

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

// Minimal dependency-free SVG bar chart for daily volume, built from the
// Custom Bars endpoint response.
export default function VolumeChart({ bars }: { bars: CustomBar[] }) {
  if (bars.length === 0) {
    return <div className="skeleton">No volume data available.</div>;
  }

  const width = 560;
  const height = 110;
  const gap = 2;
  const barWidth = width / bars.length - gap;
  const maxVolume = Math.max(...bars.map((b) => b.v));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily trading volume"
    >
      {bars.map((bar, i) => {
        const barHeight = maxVolume > 0 ? (bar.v / maxVolume) * (height - 4) : 0;
        const isUp = bar.c >= bar.o;
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect
            key={bar.t}
            x={x}
            y={y}
            width={Math.max(barWidth, 1)}
            height={Math.max(barHeight, 1)}
            fill={isUp ? "#2ecc71" : "#ff5c5c"}
            opacity={0.85}
          >
            <title>
              {new Date(bar.t).toLocaleDateString()}: volume {formatVolume(bar.v)}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
