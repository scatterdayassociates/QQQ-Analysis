import { NextResponse } from "next/server";
import { getCatalystTrackerData } from "@/lib/catalysts";

export const revalidate = 3600; // 1 hour cache, safe now that sequential throttling prevents rate limiting

export async function GET() {
  try {
    const data = await getCatalystTrackerData();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
