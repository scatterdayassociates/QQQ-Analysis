import { NextRequest, NextResponse } from "next/server";
import { getAiEarningsData } from "@/lib/aiEarnings";

export const revalidate = 3600;
// On a cold cache (see lib/aiEarnings.ts's getAiEarningsCoreData), this
// route runs the full sequenced 27-request Alpha Vantage sweep inline,
// which can take up to ~80s — needs a raised Function "Max Duration" in
// Vercel to match (see app/api/ai-earnings/refresh/route.ts's comment).
// Ordinary page views (cache warm, which is the common case once the daily
// cron has run at least once) return almost immediately.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const expiration = request.nextUrl.searchParams.get("expiration") ?? undefined;
    const data = await getAiEarningsData(expiration);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
