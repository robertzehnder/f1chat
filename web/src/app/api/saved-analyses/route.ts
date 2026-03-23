import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    rows: [],
    count: 0,
    message: "Saved analyses persistence is not wired yet."
  });
}
