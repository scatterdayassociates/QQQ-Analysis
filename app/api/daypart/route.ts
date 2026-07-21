import { NextRequest, NextResponse } from "next/server";
import { getDaypartData } from "@/lib/massive";

export const revalidate = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultEtDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return formatter.format(new Date());
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? defaultEtDate();
  const startTime = req.nextUrl.searchParams.get("startTime") ?? "09:30";
  const endTime = req.nextUrl.searchParams.get("endTime") ?? "16:00";

  if (!DATE_RE.test(date) || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return NextResponse.json({ error: "Invalid date or time format." }, { status: 400 });
  }
  if (startTime >= endTime) {
    return NextResponse.json({ error: "startTime must be earlier than endTime." }, { status: 400 });
  }

  try {
    const data = await getDaypartData(date, startTime, endTime);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
