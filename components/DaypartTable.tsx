"use client";

import type { DaypartBucket } from "@/lib/massive";

function formatVolume(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return String(v);
}

interface DaypartTableProps {
  buckets: DaypartBucket[];
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
}

export default function DaypartTable({ buckets, hoveredIndex, onHover }: DaypartTableProps) {
  return (
    <div className="table-wrap">
      <table className="mono">
        <thead>
          <tr>
            <th>Time (ET)</th>
            <th>QQQ Volume</th>
            <th>TQQQ Volume</th>
            <th>VIX (IV proxy)</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr
              key={b.time}
              className={hoveredIndex === i ? "active" : undefined}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
            >
              <td>{b.time}</td>
              <td>{formatVolume(b.qqqVolume)}</td>
              <td>{formatVolume(b.tqqqVolume)}</td>
              <td>{b.vix !== null ? b.vix.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
