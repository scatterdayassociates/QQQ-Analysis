import { NextResponse, type NextRequest } from "next/server";
import { runSessionClose } from "@/lib/odte/engine";
import { authorizeCron } from "@/lib/odte/cronAuth";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Fired at 20:25 and 21:25 UTC weekdays (vercel.json) — one of the two lands
// at ~16:25 ET in each DST regime; runSessionClose's ET guard skips the other.
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  try {
    const result = await runSessionClose();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[odte] session-close failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
