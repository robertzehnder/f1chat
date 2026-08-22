import { NextRequest, NextResponse } from "next/server";
import { clampInt } from "@/lib/querySafety";
import { listConversations } from "@/lib/chat/conversationStore";

export const dynamic = "force-dynamic";

// Auth-shim is guest-only today; every conversation belongs to 'guest'.
// When real auth lands, derive this from the session instead.
const USER_ID = "guest";

export async function GET(req: NextRequest) {
  const limit = clampInt(
    Number(req.nextUrl.searchParams.get("limit") ?? "50"),
    1,
    200
  );
  const rows = await listConversations(USER_ID, limit);
  return NextResponse.json({ rows, count: rows.length });
}
