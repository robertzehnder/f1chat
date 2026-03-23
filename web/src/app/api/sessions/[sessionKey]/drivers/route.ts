import { NextResponse } from "next/server";
import { getSessionDrivers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionKey: string }> }
) {
  const { sessionKey } = await context.params;
  const key = Number(sessionKey);
  if (!Number.isFinite(key)) {
    return NextResponse.json({ error: "Invalid sessionKey" }, { status: 400 });
  }

  const rows = await getSessionDrivers(key);
  return NextResponse.json({ rows, count: rows.length });
}
