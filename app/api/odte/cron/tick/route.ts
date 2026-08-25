import { NextResponse, type NextRequest } from "next/server";
import { runTick } from "@/lib/odte/engine";
import { authorizeCron } from "@/lib/odte/cronAuth";

// A tick is normally 2-3 API calls + DB writes, but it self-heals a missed
// session-init inline (EF-table rebuild), so give it init-sized headroom.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Fired every 2 minutes, 13:00–21:59 UTC weekdays (vercel.json) — wide enough
// to cover RTH in both EDT and EST; runTick's own ET guard no-ops the firings
// that fall outside 9:31–16:20 ET.
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  try {
    const result = await runTick();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[odte] tick failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
