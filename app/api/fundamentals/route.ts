import { NextResponse } from "next/server";
import { getFundamentalAnalysis } from "@/lib/fundamentals";

export const revalidate = 3600; // this is a daily/positional model, not intraday

export async function GET() {
  try {
    const data = await getFundamentalAnalysis();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
