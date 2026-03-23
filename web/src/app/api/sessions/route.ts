import { NextRequest, NextResponse } from "next/server";
import { getSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rows = await getSessions({
    year: parseOptionalInt(params.get("year")),
    country: params.get("country") ?? undefined,
    search: params.get("q") ?? undefined,
    limit: parseOptionalInt(params.get("limit")),
    offset: parseOptionalInt(params.get("offset"))
  });
  return NextResponse.json({ rows, count: rows.length });
}
