"use client";

import { useMemo, useState } from "react";

interface GapCalendarPickerProps {
  minDate: string; // YYYY-MM-DD
  maxDate: string; // YYYY-MM-DD
  taggedDates: Set<string>;
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export default function GapCalendarPicker({ minDate, maxDate, taggedDates, selected, onChange }: GapCalendarPickerProps) {
  const maxD = new Date(`${maxDate}T00:00:00Z`);
  const minD = new Date(`${minDate}T00:00:00Z`);
  const [viewYear, setViewYear] = useState(maxD.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(maxD.getUTCMonth());
  const [anchor, setAnchor] = useState<string | null>(null);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startWeekday = firstOfMonth.getUTCDay();
    const numDays = daysInMonth(viewYear, viewMonth);
    const arr: (string | null)[] = Array(startWeekday).fill(null);
    for (let day = 1; day <= numDays; day++) {
      arr.push(toDateStr(new Date(Date.UTC(viewYear, viewMonth, day))));
    }
    return arr;
  }, [viewYear, viewMonth]);

  const canGoPrev = new Date(Date.UTC(viewYear, viewMonth, 1)) > minD;
  const canGoNext = new Date(Date.UTC(viewYear, viewMonth + 1, 1)) <= maxD;

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNext = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const toggle = (date: string, shiftKey: boolean) => {
    if (date < minDate || date > maxDate) return;
    const next = new Set(selected);
    if (shiftKey && anchor) {
      const [lo, hi] = anchor <= date ? [anchor, date] : [date, anchor];
      const cursor = new Date(`${lo}T00:00:00Z`);
      const end = new Date(`${hi}T00:00:00Z`);
      while (cursor <= end) {
        next.add(toDateStr(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    } else {
      if (next.has(date)) next.delete(date);
      else next.add(date);
      setAnchor(date);
    }
    onChange(next);
  };

  return (
    <div className="gap-calendar">
      <div className="gap-calendar-head">
        <button type="button" className="gap-calendar-nav" onClick={goPrev} disabled={!canGoPrev} aria-label="Previous month">
          ‹
        </button>
        <span className="gap-calendar-title mono">
          {MONTH_LABELS[viewMonth]} {viewYear}
        </span>
        <button type="button" className="gap-calendar-nav" onClick={goNext} disabled={!canGoNext} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="gap-calendar-grid">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} className="gap-calendar-weekday">
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (date === null) return <div key={i} className="gap-calendar-cell empty" />;
          const disabled = date < minDate || date > maxDate;
          const isSelected = selected.has(date);
          const isTagged = taggedDates.has(date);
          return (
            <button
              key={date}
              type="button"
              className={`gap-calendar-cell${isSelected ? " selected" : ""}${isTagged ? " tagged" : ""}`}
              disabled={disabled}
              onClick={(e) => toggle(date, e.shiftKey)}
              title={date}
            >
              {Number(date.slice(8))}
              {isTagged && <span className="gap-calendar-dot" />}
            </button>
          );
        })}
      </div>

      <div className="gap-calendar-actions">
        <button type="button" className="add-entry-btn" onClick={() => onChange(new Set())} disabled={selected.size === 0}>
          Clear selection
        </button>
        <span className="gap-calendar-hint mono">
          {selected.size > 0
            ? `${selected.size} date${selected.size === 1 ? "" : "s"} selected`
            : "Click dates to select · shift-click to select a range"}
        </span>
      </div>
    </div>
  );
}
