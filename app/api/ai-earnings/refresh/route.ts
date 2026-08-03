import { NextRequest, NextResponse } from "next/server";
import { refreshAiEarningsCoreData } from "@/lib/aiEarnings";

export const dynamic = "force-dynamic";
// The full sequenced sweep is 27 Alpha Vantage requests spaced 1-3s apart
// (see lib/aiEarnings.ts's module comment) — worst case a bit over 80s.
// Default Vercel function timeouts (10s Hobby, 15s Pro) are well short of
// that; this needs the project's Function "Max Duration" raised to cover
// it (Pro/Enterprise support up to 300s+ depending on plan/region — verify
// against the current Vercel plan and adjust here to match).
export const maxDuration = 120;

/**
 * Daily pre-warm for the AI Earnings Analysis fundamentals screen. Every
 * ordinary page view reads lib/aiEarnings.ts's in-memory 24h cache
 * (getAiEarningsCoreData) instead of hitting Alpha Vantage directly — this
 * route is what actually populates that cache once a day (vercel.json's
 * cron), so the first visitor of the day doesn't have to wait on the full
 * 27-request sequenced sweep. If the cache is still cold when a page view
 * happens anyway (e.g. right after a fresh deploy, before the cron has
 * fired), getAiEarningsCoreData falls back to running the sweep inline.
 *
 * Protected by CRON_SECRET when set (Vercel automatically sends it as
 * `Authorization: Bearer $CRON_SECRET` for routes triggered by its own
 * cron config) — same convention as /api/yield-regime/refresh.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    const provided = authHeader?.replace(/^Bearer\s+/i, "") ?? querySecret ?? "";
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    await refreshAiEarningsCoreData();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
