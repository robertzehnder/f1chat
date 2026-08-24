import { NextRequest, NextResponse } from "next/server";
import { clampInt } from "@/lib/querySafety";
import { listConversations } from "@/lib/chat/conversationStore";
import { getSessionUserId } from "@/lib/auth/server";

export const dynamic = "force-dynamic";



export async function GET(req: NextRequest) {
  const limit = clampInt(
    Number(req.nextUrl.searchParams.get("limit") ?? "50"),
    1,
    200
  );
  // Signed-in users see their own conversations; anonymous visitors see
  // the legacy shared 'guest' pool (also what cookie-less harnesses use).
  const rows = await listConversations(await getSessionUserId(), limit);
  return NextResponse.json({ rows, count: rows.length });
}
