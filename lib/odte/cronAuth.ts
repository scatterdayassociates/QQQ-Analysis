// Shared guard for the 0DTE cron/admin routes. Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the CRON_SECRET
// env var is set on the project; manual invocations can pass ?secret= instead.
// If CRON_SECRET is unset the routes stay open (dev convenience) — set it in
// production.

import { NextResponse, type NextRequest } from "next/server";

export function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[odte] CRON_SECRET not set — cron/admin route running unauthenticated (set it in Vercel env vars)");
    return null;
  }
  const header = req.headers.get("authorization");
  const param = req.nextUrl.searchParams.get("secret");
  if (header === `Bearer ${secret}` || param === secret) return null;
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
