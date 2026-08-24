import { NextResponse } from "next/server";
import { getCatalystTrackerData } from "@/lib/catalysts";

export const revalidate = 10; // temporarily reduced for debugging earnings lookup

export async function GET() {
  try {
    const data = await getCatalystTrackerData();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
