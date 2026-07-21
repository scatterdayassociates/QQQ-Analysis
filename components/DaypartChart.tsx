"use client";

import type { DaypartBucket } from "@/lib/massive";

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

// Dependency-free SVG combo chart: grouped bars for QQQ/TQQQ volume on the
// left axis, VIX plotted as a line on an independent right-axis scale.
export default function DaypartChart({ buckets }: { buckets: DaypartBucket[] }) {
  if (buckets.length === 0) {
    return <div className="skeleton">No data for this range.</div>;
  }

  const width = 900;
  const height = 240;
  const padding = { top: 10, right: 10, bottom: 22, left: 10 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxVolume = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.qqqVolume ?? 0, b.tqqqVolume ?? 0))
  );
  const vixValues = buckets.map((b) => b.vix).filter((v): v is number => v !== null);
  const maxVix = vixValues.length ? Math.max(...vixValues) * 1.15 : 1;

  const slot = plotW / buckets.length;
  const barGap = 2;
  const barWidth = Math.max((slot - barGap * 3) / 2, 1);

  const vixPoints = buckets
    .map((b, i) => {
      if (b.vix === null) return null;
      const x = padding.left + i * slot + slot / 2;
      const y = padding.top + plotH - (b.vix / maxVix) * plotH;
      return `${x},${y}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Intraday volume and VIX chart"
    >
      {buckets.map((b, i) => {
        const xBase = padding.left + i * slot + barGap;
        const qqqHeight = ((b.qqqVolume ?? 0) / maxVolume) * plotH;
        const tqqqHeight = ((b.tqqqVolume ?? 0) / maxVolume) * plotH;
        return (
          <g key={b.time}>
            <rect
              x={xBase}
              y={padding.top + plotH - qqqHeight}
              width={barWidth}
              height={Math.max(qqqHeight, b.qqqVolume ? 1 : 0)}
              fill="#5b8def"
              opacity={0.9}
            >
              <title>
                {b.time} ET — QQQ volume: {b.qqqVolume !== null ? formatVolume(b.qqqVolume) : "n/a"}
              </title>
            </rect>
            <rect
              x={xBase + barWidth + barGap}
              y={padding.top + plotH - tqqqHeight}
              width={barWidth}
              height={Math.max(tqqqHeight, b.tqqqVolume ? 1 : 0)}
              fill="#a56de2"
              opacity={0.9}
            >
              <title>
                {b.time} ET — TQQQ volume: {b.tqqqVolume !== null ? formatVolume(b.tqqqVolume) : "n/a"}
              </title>
            </rect>
          </g>
        );
      })}

      {vixPoints && <polyline points={vixPoints} fill="none" stroke="#f5b942" strokeWidth={2} />}

      {buckets.map((b, i) => {
        if (b.vix === null) return null;
        const x = padding.left + i * slot + slot / 2;
        const y = padding.top + plotH - (b.vix / maxVix) * plotH;
        return (
          <circle key={`vix-${b.time}`} cx={x} cy={y} r={2.5} fill="#f5b942">
            <title>
              {b.time} ET — VIX: {b.vix.toFixed(2)}
            </title>
          </circle>
        );
      })}

      {buckets.map((b, i) => {
        if (i % 2 !== 0) return null; // thin out labels so they don't overlap
        const x = padding.left + i * slot + slot / 2;
        return (
          <text key={`label-${b.time}`} x={x} y={height - 6} fontSize={9} textAnchor="middle" fill="#8b93a1">
            {b.time}
          </text>
        );
      })}
    </svg>
  );
}
