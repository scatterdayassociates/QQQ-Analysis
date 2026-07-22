"use client";

import { useMemo } from "react";
import type { GapCatalystType, OvernightGap } from "@/lib/overnightGap";

const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const CATALYST_ORDER: ("None" | GapCatalystType)[] = ["None", "Earnings", "FOMC", "CPI", "NFP"];

interface OvernightGapSummaryProps {
  gaps: OvernightGap[];
}

interface SummaryCell {
  weekday: string;
  catalyst: "None" | GapCatalystType;
  count: number;
  avgAbs: number;
  maxAbs: number;
}

// A date can carry multiple tags (e.g. a CPI day that's also an earnings
// day for one ticker). For this aggregate table each gap is bucketed under
// a single dominant tag — Earnings first (most specific to that ticker),
// then FOMC/CPI/NFP — rather than double-counting it in more than one row.
// The ranked table below still shows every tag a gap actually carries.
function dominantCatalyst(g: OvernightGap): "None" | GapCatalystType {
  if (g.tags.some((t) => t.type === "Earnings")) return "Earnings";
  if (g.tags.some((t) => t.type === "FOMC")) return "FOMC";
  if (g.tags.some((t) => t.type === "CPI")) return "CPI";
  if (g.tags.some((t) => t.type === "NFP")) return "NFP";
  return "None";
}

export default function OvernightGapSummary({ gaps }: OvernightGapSummaryProps) {
  const cells = useMemo<SummaryCell[]>(() => {
    const buckets = new Map<string, number[]>();
    for (const g of gaps) {
      if (g.flagged) continue; // exclude probable halts/data gaps from the stats
      if (!WEEKDAY_ORDER.includes(g.weekday)) continue;
      const key = `${g.weekday}|${dominantCatalyst(g)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(Math.abs(g.gapPct));
    }

    const result: SummaryCell[] = [];
    for (const weekday of WEEKDAY_ORDER) {
      for (const catalyst of CATALYST_ORDER) {
        const vals = buckets.get(`${weekday}|${catalyst}`) ?? [];
        if (vals.length === 0) continue;
        result.push({
          weekday,
          catalyst,
          count: vals.length,
          avgAbs: vals.reduce((a, b) => a + b, 0) / vals.length,
          maxAbs: Math.max(...vals),
        });
      }
    }
    return result;
  }, [gaps]);

  return (
    <div className="table-wrap">
      <table className="mono">
        <thead>
          <tr>
            <th>Weekday</th>
            <th>Catalyst</th>
            <th>N</th>
            <th>Avg |Gap %|</th>
            <th>Max |Gap %|</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c, i) => (
            <tr key={i}>
              <td>{c.weekday.slice(0, 3)}</td>
              <td>
                {c.catalyst !== "None" ? (
                  <span className={`event-chip event-${c.catalyst.toLowerCase()}`}>{c.catalyst}</span>
                ) : (
                  "None"
                )}
              </td>
              <td>{c.count}</td>
              <td>{c.avgAbs.toFixed(2)}</td>
              <td>{c.maxAbs.toFixed(2)}</td>
            </tr>
          ))}
          {cells.length === 0 && (
            <tr>
              <td colSpan={5} className="skeleton">
                Not enough data in the current selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
