import { NextRequest, NextResponse } from "next/server";
import { getSessionRaceControl } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionKey: string }> }
) {
  const { sessionKey } = await context.params;
  const key = Number(sessionKey);
  if (!Number.isFinite(key)) {
    return NextResponse.json({ error: "Invalid sessionKey" }, { status: 400 });
  }
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "500");
  const rows = await getSessionRaceControl(key, Number.isFinite(limit) ? limit : 500);
  return NextResponse.json({ rows, count: rows.length });
}
