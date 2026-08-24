import { NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  getConversationMessages,
  isConversationId,
  renameConversation
} from "@/lib/chat/conversationStore";
import { getSessionUserId } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!isConversationId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const conversation = await getConversationMessages(id, await getSessionUserId());
  if (!conversation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(conversation);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!isConversationId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 120) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }
  const renamed = await renameConversation(id, title, await getSessionUserId());
  if (!renamed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, title });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!isConversationId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const deleted = await deleteConversation(id, await getSessionUserId());
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
