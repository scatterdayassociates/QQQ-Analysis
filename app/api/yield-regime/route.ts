import { NextRequest, NextResponse } from "next/server";
import { ensureFreshRegimeData, getCurrentRegimeState, getRegimeEpisodes, getRegimeSeries } from "@/lib/yieldRegime";

export const revalidate = 3600; // regime state changes at most once per trading day; ensureFreshRegimeData is the real freshness gate

const VALID_RANGES = new Set(["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "Max"]);

export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1Y";
  const range = VALID_RANGES.has(rangeParam) ? rangeParam : "1Y";

  try {
    await ensureFreshRegimeData();
    const [current, series, episodes] = await Promise.all([getCurrentRegimeState(), getRegimeSeries(range), getRegimeEpisodes()]);
    return NextResponse.json({ current, series, episodes, range });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
