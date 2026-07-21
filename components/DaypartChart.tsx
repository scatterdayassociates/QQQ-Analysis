"use client";

import type { DaypartBucket } from "@/lib/massive";

function formatVolumeAxis(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

interface DaypartChartProps {
  buckets: DaypartBucket[];
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
}

// Dependency-free SVG combo chart: grouped bars for QQQ/TQQQ volume against
// a left axis, the realized-vol proxy plotted as a line against an
// independent right axis.
export default function DaypartChart({ buckets, hoveredIndex, onHover }: DaypartChartProps) {
  if (buckets.length === 0) {
    return <div className="skeleton">No data for this range.</div>;
  }

  const width = 960;
  const height = 300;
  const padding = { top: 12, right: 46, bottom: 26, left: 46 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxVolume = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.qqqVolume ?? 0, b.tqqqVolume ?? 0))
  ) * 1.08;

  const volValues = buckets.map((b) => b.volatilityPct).filter((v): v is number => v !== null);
  const maxVol = volValues.length ? Math.max(...volValues) + 3 : 30;
  const minVol = volValues.length ? Math.max(0, Math.min(...volValues) - 3) : 0;

  const slot = plotW / buckets.length;
  const barGap = 3;
  const barWidth = Math.max((slot - barGap * 3) / 2, 1);

  const gridSteps = 4;
  const volumeGridLines = Array.from({ length: gridSteps + 1 }, (_, i) => (maxVolume / gridSteps) * i);
  const volGridLines = Array.from({ length: gridSteps + 1 }, (_, i) => minVol + ((maxVol - minVol) / gridSteps) * i);

  const volPoints = buckets
    .map((b, i) => {
      if (b.volatilityPct === null) return null;
      const x = padding.left + i * slot + slot / 2;
      const y = padding.top + plotH - ((b.volatilityPct - minVol) / (maxVol - minVol)) * plotH;
      return `${x},${y}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");

  const hoverX =
    hoveredIndex !== null ? padding.left + hoveredIndex * slot + slot / 2 : null;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Intraday volume and realized volatility chart"
      onMouseLeave={() => onHover(null)}
    >
      {volumeGridLines.map((gv, i) => {
        const gy = padding.top + plotH - (gv / maxVolume) * plotH;
        return (
          <g key={`grid-${i}`}>
            <line className="gridline" x1={padding.left} x2={width - padding.right} y1={gy} y2={gy} />
            <text className="axis-label" x={padding.left - 8} y={gy + 3} textAnchor="end">
              {formatVolumeAxis(gv)}
            </text>
          </g>
        );
      })}

      {volGridLines.map((vv, i) => {
        const vy = padding.top + plotH - ((vv - minVol) / (maxVol - minVol)) * plotH;
        return (
          <text
            key={`vol-grid-${i}`}
            className="axis-label"
            x={width - padding.right + 8}
            y={vy + 3}
            textAnchor="start"
            fill="var(--accent-vol)"
          >
            {vv.toFixed(0)}
          </text>
        );
      })}

      {buckets.map((b, i) => {
        const xBase = padding.left + i * slot;
        const qqqHeight = ((b.qqqVolume ?? 0) / maxVolume) * plotH;
        const tqqqHeight = ((b.tqqqVolume ?? 0) / maxVolume) * plotH;
        const opacity = hoveredIndex === null || hoveredIndex === i ? 1 : 0.38;

        return (
          <g key={b.time} opacity={opacity}>
            <rect
              x={xBase + barGap}
              y={padding.top + plotH - qqqHeight}
              width={barWidth}
              height={Math.max(qqqHeight, b.qqqVolume ? 1 : 0)}
              fill="var(--accent-qqq)"
              rx={1.5}
            />
            <rect
              x={xBase + barGap * 2 + barWidth}
              y={padding.top + plotH - tqqqHeight}
              width={barWidth}
              height={Math.max(tqqqHeight, b.tqqqVolume ? 1 : 0)}
              fill="var(--accent-tqqq)"
              rx={1.5}
            />
            <rect
              className="bucket-hit"
              x={xBase}
              y={padding.top}
              width={slot}
              height={plotH}
              onMouseEnter={() => onHover(i)}
            />
          </g>
        );
      })}

      {volPoints && (
        <polyline points={volPoints} fill="none" stroke="var(--accent-vol)" strokeWidth={2.25} strokeLinejoin="round" />
      )}

      {buckets.map((b, i) => {
        if (b.volatilityPct === null) return null;
        const x = padding.left + i * slot + slot / 2;
        const y = padding.top + plotH - ((b.volatilityPct - minVol) / (maxVol - minVol)) * plotH;
        return <circle key={`vol-${b.time}`} cx={x} cy={y} r={2.6} fill="var(--accent-vol)" />;
      })}

      {buckets.map((b, i) => {
        if (i % 2 !== 0 && i !== buckets.length - 1) return null;
        const x = padding.left + i * slot + slot / 2;
        return (
          <text key={`label-${b.time}`} className="axis-label" x={x} y={height - 6} textAnchor="middle">
            {b.time}
          </text>
        );
      })}

      {hoverX !== null && (
        <line className="hover-guide" x1={hoverX} x2={hoverX} y1={padding.top} y2={padding.top + plotH} />
      )}
    </svg>
  );
}
