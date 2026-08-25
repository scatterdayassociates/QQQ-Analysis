import { NextResponse, type NextRequest } from "next/server";
import { runOdteMigration } from "@/lib/odte/db";
import { authorizeCron } from "@/lib/odte/cronAuth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// One-time (but idempotent) schema setup:
//   GET /api/odte/migrate?secret=<CRON_SECRET>
// Runs migrations/001_odte_schema.sql (embedded copy in lib/odte/schema.ts)
// against ODTE_DATABASE_URL. Safe to re-run any time.
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  try {
    await runOdteMigration();
    return NextResponse.json({ ok: true, message: "0DTE schema is in place (all statements idempotent)" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[odte] migrate failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
