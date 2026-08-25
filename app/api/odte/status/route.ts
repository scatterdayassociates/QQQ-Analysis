import { NextResponse } from "next/server";
import { getOdteStatus } from "@/lib/odte/engine";

export const dynamic = "force-dynamic";

// UI read endpoint for the "0 DTE Opportunity Analysis" tab. All heavy work
// happens in the cron passes; this only reads Postgres, so it stays fast and
// is safe to refresh freely.
export async function GET() {
  try {
    const status = await getOdteStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[odte] status failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
