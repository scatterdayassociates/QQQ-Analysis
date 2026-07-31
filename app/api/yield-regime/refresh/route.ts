import { NextRequest, NextResponse } from "next/server";
import { refreshRegimeData } from "@/lib/yieldRegime";

export const dynamic = "force-dynamic"; // this route writes to MySQL — never let it be treated as a cacheable/static response

/**
 * Manual/cron trigger for the regime refresh job. In practice this is a
 * belt-and-suspenders pre-warm — every read via GET /api/yield-regime
 * already self-heals stale data (see ensureFreshRegimeData) — but Vercel
 * Cron (vercel.json) hits this daily so the first visitor of the day
 * doesn't have to wait on the FRED fetch + regime recompute.
 *
 * Protected by CRON_SECRET when set (Vercel automatically sends it as
 * `Authorization: Bearer $CRON_SECRET` for routes triggered by its own
 * cron config). If CRON_SECRET isn't configured, the route is left open —
 * the writes it triggers are idempotent upserts, same safety model as
 * every other optional-config degradation in this app — but setting one
 * is recommended so the endpoint can't be spammed by anyone who finds it.
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
    const result = await refreshRegimeData();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
