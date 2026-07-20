import { NextRequest, NextResponse } from "next/server";
import { getTickerDashboardData } from "@/lib/massive";

export const revalidate = 60;

const ALLOWED_TICKERS = new Set(["QQQ", "TQQQ"]);

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase() ?? "";

  if (!ALLOWED_TICKERS.has(ticker)) {
    return NextResponse.json(
      { error: `Unsupported ticker "${ticker}". Allowed: ${[...ALLOWED_TICKERS].join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const data = await getTickerDashboardData(ticker);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
