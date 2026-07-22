"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OvernightGapData } from "@/lib/overnightGap";
import GapCalendarPicker from "./GapCalendarPicker";
import OvernightGapSummary from "./OvernightGapSummary";
import OvernightGapTable from "./OvernightGapTable";

export default function OvernightGapPanel() {
  const [data, setData] = useState<OvernightGapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("all");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overnight-gap");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load overnight gap data");
      setData(json as OvernightGapData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overnight gap data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tickerFiltered = useMemo(() => {
    const gaps = data?.gaps ?? [];
    return tickerFilter === "all" ? gaps : gaps.filter((g) => g.ticker === tickerFilter);
  }, [data, tickerFilter]);

  const taggedDates = useMemo(() => {
    const s = new Set<string>();
    for (const g of tickerFiltered) if (g.tags.length > 0) s.add(g.date);
    return s;
  }, [tickerFiltered]);

  const scoped = useMemo(() => {
    if (selectedDates.size === 0) return tickerFiltered;
    return tickerFiltered.filter((g) => selectedDates.has(g.date));
  }, [tickerFiltered, selectedDates]);

  return (
    <div>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="gap-ticker-filter">Ticker</label>
          <select id="gap-ticker-filter" value={tickerFilter} onChange={(e) => setTickerFilter(e.target.value)}>
            <option value="all">All tracked tickers</option>
            {(data?.tickers ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-spacer" />
        <button className="apply" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && !error && (
        <>
          <div className="card">
            <div className="chart-label">Select dates</div>
            <GapCalendarPicker
              minDate={data.from}
              maxDate={data.to}
              taggedDates={taggedDates}
              selected={selectedDates}
              onChange={setSelectedDates}
            />
          </div>

          <div className="card">
            <div className="chart-label">
              Weekday / Catalyst Summary
              {selectedDates.size > 0 ? ` — ${selectedDates.size} date${selectedDates.size === 1 ? "" : "s"} selected` : ""}
            </div>
            <OvernightGapSummary gaps={scoped} />
          </div>

          <details className="card table-accordion" open>
            <summary>
              <span>Ranked Overnight Gaps{tickerFilter !== "all" ? ` — ${tickerFilter}` : ""}</span>
              <span className="table-accordion-meta mono">
                <span className="table-accordion-count">{scoped.length} rows</span>
                <svg className="table-accordion-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="table-accordion-body">
              <OvernightGapTable gaps={scoped} />
            </div>
          </details>
        </>
      )}

      <p className="footnote">
        <strong>Methodology.</strong> Overnight gap % = (Open[D] − Close[D-1]) / Close[D-1], where
        Close[D-1] is the prior trading day&apos;s 4:00 PM ET regular-session close and Open[D] is
        day D&apos;s 9:30 AM ET regular-session open — both read from Massive&apos;s daily Custom
        Bars, confirmed live against Massive&apos;s dedicated Daily Open/Close endpoint to be
        regular-session values, not extended-hours prints. This is deliberately{" "}
        <strong>not</strong> the regular-session (open-to-close) move. Rows marked ⚠ span an
        unusually long calendar gap between the two bars (a possible trading halt or data gap,
        not a routine weekend/holiday) and are excluded from the weekday/catalyst averages above,
        though still shown in the ranked list. <strong>FOMC/CPI/NFP</strong> tags come from the
        same hardcoded, source-verified macro calendar used on the Catalyst Tracker tab.{" "}
        <strong>Earnings</strong> tags come from Finnhub&apos;s free-tier Earnings Calendar —
        every known report date for a tracked ticker is surfaced, not just ones with clear
        before-open/after-close timing. Reports after the prior day&apos;s close or before the gap
        day&apos;s open get a precise AMC/BMO label since those cleanly explain <em>this specific</em>{" "}
        overnight move; reports during market hours or with unlisted timing are still tagged, on
        the report day itself, just without asserting which overnight window they drove —{" "}
        {data?.earningsCoverageFrom
          ? `and only available back to ${data.earningsCoverageFrom}, Finnhub's free-tier historical depth limit as observed live, well short of the full price-history range above.`
          : "currently unavailable (FINNHUB_API_KEY missing or the lookup failed), in which case gaps still show, just without Earnings tags."}
      </p>
    </div>
  );
}
