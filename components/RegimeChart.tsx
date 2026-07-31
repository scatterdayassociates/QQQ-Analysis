"use client";

import type { DailyRegimeRow, OverlayPoint, RegimeLabel } from "@/lib/yieldRegime";

// Shared between this chart and YieldRegimePanel's chips/legend, so both
// use the exact same regime -> CSS class / color mapping.
export function regimeSlug(regime: RegimeLabel | null): string {
  switch (regime) {
    case "Growth Steepening":
      return "growth-steepening";
    case "Term Premium Steepening":
      return "term-premium-steepening";
    case "Steepening (Mixed)":
      return "steepening-mixed";
    case "Bull Flattening":
      return "bull-flattening";
    case "Bear Flattening":
      return "bear-flattening";
    case "Flattening (Mixed)":
      return "flattening-mixed";
    case "Range-bound / No Signal":
      return "range-bound";
    default:
      return "unknown";
  }
}

const REGIME_FILL_VAR: Record<RegimeLabel, string> = {
  "Growth Steepening": "var(--up)",
  "Term Premium Steepening": "var(--down)",
  "Steepening (Mixed)": "var(--accent-vol)",
  "Bull Flattening": "var(--accent-qqq)",
  "Bear Flattening": "var(--accent-tqqq)",
  "Flattening (Mixed)": "var(--accent-earnings)",
  "Range-bound / No Signal": "var(--muted-2)",
};

interface RegimeChartProps {
  series: DailyRegimeRow[];
  qqqOverlay: OverlayPoint[] | null;
  tqqqOverlay: OverlayPoint[] | null;
  showYieldLines: boolean;
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
}

// Dependency-free SVG chart: the T10Y2Y spread as the headline line, with
// background bands shaded by regime, an optional secondary axis for
// QQQ/TQQQ price overlays, and optional raw 10Y/2Y yield lines sharing the
// spread's left axis. Follows the same categorical-x-slot, hand-rolled SVG
// approach as DaypartChart (each trading day is one equal-width slot,
// rather than true calendar-time scaling — this also means non-trading
// days simply don't exist on the axis, with no gap to explain).
export default function RegimeChart({ series, qqqOverlay, tqqqOverlay, showYieldLines, hoveredIndex, onHover }: RegimeChartProps) {
  if (series.length === 0) {
    return <div className="skeleton">No data for this range.</div>;
  }

  const width = 960;
  const height = 360;
  const padding = { top: 12, right: 52, bottom: 30, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const slot = plotW / series.length;

  const leftValues: number[] = series.map((r) => r.spread);
  if (showYieldLines) {
    for (const r of series) {
      leftValues.push(r.y10, r.y2);
    }
  }
  const leftMin = Math.min(...leftValues) - 0.25;
  const leftMax = Math.max(...leftValues) + 0.25;
  const leftScale = (v: number) => padding.top + plotH - ((v - leftMin) / (leftMax - leftMin)) * plotH;

  const overlaysVisible = [qqqOverlay, tqqqOverlay].filter((o): o is OverlayPoint[] => o !== null && o.length > 0);
  const rightVisible = overlaysVisible.length > 0;
  const rightValues = overlaysVisible.flat().map((o) => o.close);
  const rightMin = rightVisible ? Math.min(...rightValues) * 0.98 : 0;
  const rightMax = rightVisible ? Math.max(...rightValues) * 1.02 : 1;
  const rightScale = (v: number) => padding.top + plotH - ((v - rightMin) / (rightMax - rightMin)) * plotH;

  const xAt = (i: number) => padding.left + i * slot + slot / 2;

  // Background regime bands: walk `series` grouping consecutive equal
  // regimes, clipped to whatever range is currently displayed.
  const bands: { fromIdx: number; toIdx: number; regime: RegimeLabel }[] = [];
  for (let i = 0; i < series.length; i++) {
    const regime = series[i].regime;
    if (regime === null) continue;
    const last = bands[bands.length - 1];
    if (last && last.regime === regime && last.toIdx === i - 1) {
      last.toIdx = i;
    } else {
      bands.push({ fromIdx: i, toIdx: i, regime });
    }
  }

  const buildLine = (values: (number | null)[], scale: (v: number) => number): string =>
    values
      .map((v, i) => (v === null ? null : `${xAt(i)},${scale(v)}`))
      .filter((p): p is string => p !== null)
      .join(" ");

  const spreadLine = buildLine(series.map((r) => r.spread), leftScale);
  const y10Line = showYieldLines ? buildLine(series.map((r) => r.y10), leftScale) : "";
  const y2Line = showYieldLines ? buildLine(series.map((r) => r.y2), leftScale) : "";

  const overlayLine = (overlay: OverlayPoint[] | null): string => {
    if (!overlay) return "";
    const closeByDate = new Map(overlay.map((o) => [o.date, o.close]));
    return buildLine(
      series.map((r) => closeByDate.get(r.date) ?? null),
      rightScale
    );
  };
  const qqqLine = overlayLine(qqqOverlay);
  const tqqqLine = overlayLine(tqqqOverlay);

  const leftGridSteps = 5;
  const leftGridLines = Array.from({ length: leftGridSteps + 1 }, (_, i) => leftMin + ((leftMax - leftMin) / leftGridSteps) * i);
  const rightGridLines = rightVisible
    ? Array.from({ length: leftGridSteps + 1 }, (_, i) => rightMin + ((rightMax - rightMin) / leftGridSteps) * i)
    : [];

  // Sparse date labels: aim for roughly 8 evenly-spaced ticks regardless of
  // how many trading days are in the current range.
  const labelEvery = Math.max(1, Math.round(series.length / 8));

  const hoverX = hoveredIndex !== null ? xAt(hoveredIndex) : null;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="T10Y2Y spread chart with regime shading"
      onMouseLeave={() => onHover(null)}
    >
      {bands.map((b, i) => (
        <rect
          key={`band-${i}`}
          x={padding.left + b.fromIdx * slot}
          y={padding.top}
          width={(b.toIdx - b.fromIdx + 1) * slot}
          height={plotH}
          fill={REGIME_FILL_VAR[b.regime]}
          fillOpacity={0.13}
        />
      ))}

      {leftGridLines.map((gv, i) => (
        <g key={`left-grid-${i}`}>
          <line className="gridline" x1={padding.left} x2={width - padding.right} y1={leftScale(gv)} y2={leftScale(gv)} />
          <text className="axis-label" x={padding.left - 8} y={leftScale(gv) + 3} textAnchor="end">
            {gv.toFixed(1)}
          </text>
        </g>
      ))}

      {rightVisible &&
        rightGridLines.map((gv, i) => (
          <text
            key={`right-grid-${i}`}
            className="axis-label"
            x={width - padding.right + 8}
            y={rightScale(gv) + 3}
            textAnchor="start"
            fill="var(--accent-qqq)"
          >
            ${gv.toFixed(0)}
          </text>
        ))}

      {y10Line && <polyline points={y10Line} fill="none" stroke="var(--accent-vol)" strokeWidth={1.4} strokeDasharray="4 3" strokeLinejoin="round" />}
      {y2Line && <polyline points={y2Line} fill="none" stroke="var(--accent-earnings)" strokeWidth={1.4} strokeDasharray="4 3" strokeLinejoin="round" />}
      {qqqLine && <polyline points={qqqLine} fill="none" stroke="var(--accent-qqq)" strokeWidth={1.6} strokeLinejoin="round" />}
      {tqqqLine && <polyline points={tqqqLine} fill="none" stroke="var(--accent-tqqq)" strokeWidth={1.6} strokeLinejoin="round" />}
      {spreadLine && <polyline points={spreadLine} fill="none" stroke="var(--text)" strokeWidth={2.25} strokeLinejoin="round" />}

      {series.map((r, i) => {
        if (i % labelEvery !== 0 && i !== series.length - 1) return null;
        return (
          <text key={`label-${r.date}`} className="axis-label" x={xAt(i)} y={height - 8} textAnchor="middle">
            {r.date.slice(2)}
          </text>
        );
      })}

      {series.map((r, i) => (
        <rect
          key={`hit-${r.date}`}
          className="bucket-hit"
          x={padding.left + i * slot}
          y={padding.top}
          width={slot}
          height={plotH}
          onMouseEnter={() => onHover(i)}
        />
      ))}

      {hoverX !== null && <line className="hover-guide" x1={hoverX} x2={hoverX} y1={padding.top} y2={padding.top + plotH} />}
    </svg>
  );
}
