"use client";

import { useMemo, useState } from "react";
import type { OvernightGap } from "@/lib/overnightGap";

type SortKey = "date" | "ticker" | "gapPct";
type SortDir = "asc" | "desc";

interface OvernightGapTableProps {
  gaps: OvernightGap[];
}

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function OvernightGapTable({ gaps }: OvernightGapTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("gapPct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...gaps];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      else if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else cmp = a.gapPct - b.gapPct;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [gaps, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "gapPct" ? "desc" : "asc");
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="table-wrap">
      <table className="mono">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggleSort("date")}>
              Date{arrow("date")}
            </th>
            <th>Weekday</th>
            <th className="sortable" onClick={() => toggleSort("ticker")}>
              Ticker{arrow("ticker")}
            </th>
            <th className="sortable" onClick={() => toggleSort("gapPct")}>
              Overnight %{arrow("gapPct")}
            </th>
            <th>Catalyst</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => (
            <tr key={`${g.ticker}-${g.date}-${i}`} className={g.flagged ? "flagged" : undefined}>
              <td>{g.date}</td>
              <td>{g.weekday.slice(0, 3)}</td>
              <td>{g.ticker}</td>
              <td className={g.gapPct >= 0 ? "up" : "down"}>
                {formatPct(g.gapPct)}
                {g.flagged ? " ⚠" : ""}
              </td>
              <td>
                {g.tags.length === 0
                  ? "—"
                  : g.tags.map((t, j) => (
                      <span key={j} className={`event-chip event-${t.type.toLowerCase()}`} style={{ marginRight: 4 }}>
                        {t.type}
                      </span>
                    ))}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="skeleton">
                No overnight gaps in the current selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
