import { NextResponse } from "next/server";
import { getSchemaCatalog } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getSchemaCatalog();
  return NextResponse.json({ rows, count: rows.length });
}
