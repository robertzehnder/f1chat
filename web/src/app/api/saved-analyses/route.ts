import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { clampInt } from "@/lib/querySafety";

export const dynamic = "force-dynamic";

type SavedAnalysisRow = {
  id: number;
  name: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  if (idParam !== null && /^\d+$/.test(idParam)) {
    const id = Number(idParam);
    const rows = await sql<SavedAnalysisRow>(
      "SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  }

  const limit = clampInt(
    Number(req.nextUrl.searchParams.get("limit") ?? "50"),
    1,
    200
  );
  const rows = await sql<SavedAnalysisRow>(
    "SELECT id, name, payload, created_at, updated_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return NextResponse.json({ rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body?.name !== "string" || body.name.trim() === "") {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  if (body?.payload === undefined || body.payload === null) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const inserted = await sql<SavedAnalysisRow>(
    "INSERT INTO core.saved_analysis (name, payload) VALUES ($1, $2::jsonb) RETURNING id, name, payload, created_at, updated_at",
    [body.name.trim(), JSON.stringify(body.payload)]
  );
  return NextResponse.json(inserted[0], { status: 201 });
}
