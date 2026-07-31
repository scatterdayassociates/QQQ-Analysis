import { NextRequest, NextResponse } from "next/server";
import { getOverlaySeries } from "@/lib/yieldRegime";

export const revalidate = 3600; // daily bars, not intraday — same convention as the Catalyst Tracker top-10 table

const VALID_RANGES = new Set(["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "Max"]);
const VALID_SYMBOLS = new Set(["QQQ", "TQQQ"]);

export async function GET(req: NextRequest) {
  const symbolParam = req.nextUrl.searchParams.get("symbol") ?? "QQQ";
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1Y";

  if (!VALID_SYMBOLS.has(symbolParam)) {
    return NextResponse.json({ error: "symbol must be QQQ or TQQQ" }, { status: 400 });
  }
  const range = VALID_RANGES.has(rangeParam) ? rangeParam : "1Y";

  try {
    const series = await getOverlaySeries(symbolParam as "QQQ" | "TQQQ", range);
    return NextResponse.json({ symbol: symbolParam, range, series });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
