import { NextResponse } from "next/server";
import { getCatalystTrackerData } from "@/lib/catalysts";

export const revalidate = 3600; // daily/positional data, not intraday

export async function GET() {
  try {
    const data = await getCatalystTrackerData();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
