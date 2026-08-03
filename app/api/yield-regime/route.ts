import { NextRequest, NextResponse } from "next/server";
import {
  ensureFreshRegimeData,
  getCurrentRegimeState,
  getLastRefreshDiagnostics,
  getRegimeEpisodes,
  getRegimeSeries,
  REGIME_LEVEL_DEEP_INVERSION_BPS,
  REGIME_LEVEL_NORMAL_BPS,
  REGIME_LEVEL_STEEP_BPS,
  REGIME_LOOKBACK_DAYS,
  REGIME_THRESHOLD_BPS,
} from "@/lib/yieldRegime";

// Deliberately NOT `export const revalidate = N` like this app's other read
// routes — this route's entire job is to re-check DB freshness and
// self-heal on every request (see ensureFreshRegimeData). Caching this
// route's own JSON response would freeze that freshness decision at
// whatever it was when the cache was populated, silently undermining the
// self-heal regardless of what the hourly cron writes to MySQL in the
// meantime — confirmed live as the actual cause of a multi-day-stale
// T10Y2Y Regime tab even though the database itself was current.
export const dynamic = "force-dynamic";

const VALID_RANGES = new Set(["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "Max"]);

export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1Y";
  const range = VALID_RANGES.has(rangeParam) ? rangeParam : "1Y";

  try {
    await ensureFreshRegimeData();
    const [current, series, episodes] = await Promise.all([getCurrentRegimeState(), getRegimeSeries(range), getRegimeEpisodes()]);
    return NextResponse.json({
      current,
      series,
      episodes,
      range,
      refresh: getLastRefreshDiagnostics(),
      config: {
        thresholdBps: REGIME_THRESHOLD_BPS,
        lookbackDays: REGIME_LOOKBACK_DAYS,
        levelDeepInversionBps: REGIME_LEVEL_DEEP_INVERSION_BPS,
        levelNormalBps: REGIME_LEVEL_NORMAL_BPS,
        levelSteepBps: REGIME_LEVEL_STEEP_BPS,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
