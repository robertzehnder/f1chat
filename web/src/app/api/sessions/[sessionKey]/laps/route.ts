import { NextRequest, NextResponse } from "next/server";
import { getSessionLaps } from "@/lib/queries";

export const dynamic = "force-dynamic";

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionKey: string }> }
) {
  const { sessionKey } = await context.params;
  const key = Number(sessionKey);
  if (!Number.isFinite(key)) {
    return NextResponse.json({ error: "Invalid sessionKey" }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const rows = await getSessionLaps({
    sessionKey: key,
    driverNumber: parseOptionalInt(params.get("driverNumber")),
    limit: parseOptionalInt(params.get("limit")),
    offset: parseOptionalInt(params.get("offset"))
  });
  return NextResponse.json({ rows, count: rows.length });
}
