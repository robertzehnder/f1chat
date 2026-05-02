import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Phase 16-3: thumbs up/down feedback endpoint.
// POST { request_id: string, thumb: 1 | -1, reason?: string,
//        question_text?: string, category?: string,
//        generation_source?: string, client_ts?: string }
// Returns 201 on success, 400 on bad shape.

type FeedbackBody = {
  request_id?: unknown;
  thumb?: unknown;
  reason?: unknown;
  question_text?: unknown;
  category?: unknown;
  generation_source?: unknown;
  client_ts?: unknown;
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestId = asString(body.request_id);
  const thumbRaw = body.thumb;
  if (!requestId) {
    return NextResponse.json({ error: "request_id_required" }, { status: 400 });
  }
  const thumb =
    thumbRaw === 1 || thumbRaw === -1
      ? thumbRaw
      : thumbRaw === "1" || thumbRaw === "+1"
        ? 1
        : thumbRaw === "-1"
          ? -1
          : null;
  if (thumb === null) {
    return NextResponse.json({ error: "thumb_must_be_+1_or_-1" }, { status: 400 });
  }

  const reason = asString(body.reason);
  const questionText = asString(body.question_text);
  const category = asString(body.category);
  const generationSource = asString(body.generation_source);
  const clientTsStr = asString(body.client_ts);
  const clientTs =
    clientTsStr && !Number.isNaN(Date.parse(clientTsStr)) ? new Date(clientTsStr) : null;

  await sql<{ id: number }>(
    `INSERT INTO core.user_feedback
       (request_id, thumb, reason, question_text, category, generation_source, client_ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      requestId,
      thumb,
      reason,
      questionText,
      category,
      generationSource,
      clientTs ? clientTs.toISOString() : null
    ]
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
