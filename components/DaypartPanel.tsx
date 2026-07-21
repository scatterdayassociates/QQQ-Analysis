"use client";

import { useRef, useState } from "react";
import DaypartEntry from "./DaypartEntry";

const MAX_ENTRIES = 5;

export default function DaypartPanel() {
  const nextId = useRef(2);
  const [entryIds, setEntryIds] = useState<number[]>([1]);

  const addEntry = () => {
    if (entryIds.length >= MAX_ENTRIES) return;
    setEntryIds((prev) => [...prev, nextId.current++]);
  };

  const removeEntry = (id: number) => {
    setEntryIds((prev) => prev.filter((existing) => existing !== id));
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Intraday Daypart — Volume &amp; Realized Volatility</h1>
          <p className="subtitle">
            15-minute buckets across the regular session (9:30 AM–4:00 PM ET), with a realized-volatility
            proxy plotted alongside QQQ/TQQQ volume. Compare up to {MAX_ENTRIES} dates at once.
          </p>
        </div>
      </div>

      <div className="daypart-entries">
        {entryIds.map((id, i) => (
          <DaypartEntry
            key={id}
            entryId={id}
            label={`Date range ${i + 1}`}
            showRemove={entryIds.length > 1}
            onRemove={() => removeEntry(id)}
          />
        ))}
      </div>

      <div className="add-entry-row">
        <button type="button" className="add-entry-btn" onClick={addEntry} disabled={entryIds.length >= MAX_ENTRIES}>
          + Add date range
        </button>
        {entryIds.length >= MAX_ENTRIES && (
          <span className="add-entry-hint">Maximum {MAX_ENTRIES} date ranges at once.</span>
        )}
      </div>

      <p className="footnote">
        <strong>Methodology.</strong> The volatility line uses the Parkinson range estimator — computed
        from each 15-minute QQQ bar&apos;s own high/low and annualized to a percentage — as a stand-in for
        implied volatility. True IV belongs to individual option contracts (strike + expiry), not the
        underlying ticker, and a market-wide index like VIX is billed as a separate Indices subscription;
        this proxy needs neither, since it&apos;s derived entirely from the QQQ volume data already being
        fetched. It is <em>realized</em> (backward-looking, from price ranges), not <em>implied</em>
        (forward-looking, from option prices) volatility. Volume and price ranges are read from the
        Massive Custom Bars endpoint in 15-minute buckets, Eastern Time.
      </p>
    </section>
  );
}
