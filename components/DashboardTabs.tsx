"use client";

import { useState } from "react";
import DaypartPanel from "./DaypartPanel";
import FundamentalAnalysisPanel from "./FundamentalAnalysisPanel";
import CatalystPanel from "./CatalystPanel";
import AIEarningsPanel from "./AIEarningsPanel";
import YieldRegimePanel from "./YieldRegimePanel";
import SmartMoneyPanel from "./SmartMoneyPanel";

const TABS = [
  { key: "daypart", label: "Daypart Volume Analysis" },
  { key: "fundamentals", label: "Fundamental Analysis" },
  { key: "catalysts", label: "Catalyst Tracker" },
  { key: "ai-earnings", label: "AI Earnings Analysis" },
  { key: "yield-regime", label: "TBill Yield Spread Analysis" },
  { key: "smart-money", label: "Smart Money Pipeline" },
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
      {active === "catalysts" && <CatalystPanel />}
      {active === "ai-earnings" && <AIEarningsPanel />}
      {active === "yield-regime" && <YieldRegimePanel />}
      {active === "smart-money" && <SmartMoneyPanel />}
    </div>
  );
}
