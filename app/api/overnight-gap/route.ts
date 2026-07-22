import { NextRequest, NextResponse } from "next/server";
import { getOvernightGapData } from "@/lib/overnightGap";

export const revalidate = 3600;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LOOKBACK_DAYS = 240; // matches the lookback already used for Catalyst Tracker, for consistency

function defaultEtDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return formatter.format(new Date());
}

function daysAgo(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const today = defaultEtDate();
  const to = req.nextUrl.searchParams.get("to") ?? today;
  const from = req.nextUrl.searchParams.get("from") ?? daysAgo(today, DEFAULT_LOOKBACK_DAYS);

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "from must not be after to." }, { status: 400 });
  }

  // This feature is historical (realized close-to-open moves) only — clamp
  // any future `to` back to today rather than returning an empty tail.
  const clampedTo = to > today ? today : to;

  try {
    const data = await getOvernightGapData(from, clampedTo);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
