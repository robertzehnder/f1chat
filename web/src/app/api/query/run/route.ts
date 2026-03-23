import { NextResponse } from "next/server";
import { runReadOnlySql } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { sql?: string; maxRows?: number; timeoutMs?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sql) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }

  try {
    const result = await runReadOnlySql(body.sql, {
      maxRows: body.maxRows,
      timeoutMs: body.timeoutMs,
      preview: false
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 400 }
    );
  }
}
