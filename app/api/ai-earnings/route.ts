import { NextRequest, NextResponse } from "next/server";
import { getAiEarningsData } from "@/lib/aiEarnings";

export const revalidate = 3600;

export async function GET(request: NextRequest) {
  try {
    const expiration = request.nextUrl.searchParams.get("expiration") ?? undefined;
    const data = await getAiEarningsData(expiration);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
