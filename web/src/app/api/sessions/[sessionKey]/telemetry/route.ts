import { NextRequest, NextResponse } from "next/server";
import { getSessionTelemetry } from "@/lib/queries";

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
  const table = params.get("table") ?? "car_data";

  try {
    const rows = await getSessionTelemetry({
      sessionKey: key,
      table,
      driverNumber: parseOptionalInt(params.get("driverNumber")),
      fromDate: params.get("fromDate") ?? undefined,
      toDate: params.get("toDate") ?? undefined,
      limit: parseOptionalInt(params.get("limit"))
    });
    return NextResponse.json({ rows, count: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch telemetry" },
      { status: 400 }
    );
  }
}
