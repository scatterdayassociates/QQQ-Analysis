"use client";

import { useState } from "react";
import DaypartPanel from "./DaypartPanel";
import FundamentalAnalysisPanel from "./FundamentalAnalysisPanel";

const TABS = [
  { key: "daypart", label: "Intraday Daypart" },
  { key: "fundamentals", label: "Fundamental Analysis" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function DashboardTabs() {
  const [active, setActive] = useState<TabKey>("daypart");

  return (
    <div>
      <div className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`tab-btn${active === t.key ? " active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "daypart" && <DaypartPanel />}
      {active === "fundamentals" && <FundamentalAnalysisPanel />}
    </div>
  );
}
