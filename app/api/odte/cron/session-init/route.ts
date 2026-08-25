import { NextResponse, type NextRequest } from "next/server";
import { runSessionInit } from "@/lib/odte/engine";
import { authorizeCron } from "@/lib/odte/cronAuth";

// EF-table build fetches ~30 days of minute bars sequentially — needs headroom
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Fired at 13:15 and 14:15 UTC on weekdays (vercel.json). Cron has no timezone
// support, so both firings cover EDT/EST; runSessionInit itself checks ET and
// the ~9:15 firing is the one that does the work — the other is pre-open too,
// and running init twice is harmless (idempotent).
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  try {
    const result = await runSessionInit();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[odte] session-init failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
