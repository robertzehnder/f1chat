import { NextRequest, NextResponse } from "next/server";
import { claimGuestConversations, purgeStaleGuestConversations } from "@/lib/chat/conversationStore";
import { getSessionUserId, guestUserIdFromRequest } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Guest → account migration, called by the client right after a session
// appears (sign-up or sign-in) while a browser-session guest id exists.
// Requires BOTH a real session and a well-formed x-guest-id; idempotent.
export async function POST(req: NextRequest) {
  const accountUserId = await getSessionUserId();
  if (accountUserId === "guest") {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const guestUserId = guestUserIdFromRequest(req);
  if (!guestUserId) {
    return NextResponse.json({ claimed: 0 });
  }
  const claimed = await claimGuestConversations(guestUserId, accountUserId);
  // Opportunistic hygiene while we're here — never blocks the response.
  void purgeStaleGuestConversations();
  return NextResponse.json({ claimed });
}
