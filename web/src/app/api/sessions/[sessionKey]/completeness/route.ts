import { NextResponse } from "next/server";
import { getSessionCompleteness } from "@/lib/queries";

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

  const row = await getSessionCompleteness(key);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ row });
}
