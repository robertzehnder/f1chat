import { consumeChatStream } from "./consumeChatStream";
import type {
  ChatApiResponse,
  ChatMessageAssistant,
  Conversation,
  MessagePart
} from "@/lib/chatTypes";
import type { ResolvedSessionContext } from "@/lib/chatContext";
import type { ComposerContext } from "@/components/chat/Composer";

export type SendChatMessageArgs = {
  text: string;
  snapshotAtSend: ComposerContext;
  assistantTime: string;
  placeholderId: string;
};

export type SendChatMessageDeps = {
  fetchImpl?: typeof fetch;
  patchActiveConversation(updater: (c: Conversation) => Conversation): void;
  setResolved(ctx: ResolvedSessionContext | null): void;
  setComposerCtx(ctx: ComposerContext): void;
  mapResponseToParts(response: ChatApiResponse): MessagePart[];
  deriveResolved(response: ChatApiResponse): ResolvedSessionContext;
};

function replacePlaceholder(
  conversation: Conversation,
  placeholderId: string,
  patch: (m: ChatMessageAssistant) => ChatMessageAssistant
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.id === placeholderId && m.role === "assistant" ? patch(m) : m
    )
  };
}

export async function sendChatMessage(
  args: SendChatMessageArgs,
  deps: SendChatMessageDeps
): Promise<void> {
  const { text, snapshotAtSend, assistantTime, placeholderId } = args;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const placeholder: ChatMessageAssistant = {
    id: placeholderId,
    role: "assistant",
    createdAt: assistantTime,
    parts: []
  };

  deps.patchActiveConversation((c) => ({
    ...c,
    updatedAt: assistantTime,
    messages: [...c.messages, placeholder]
  }));

  let cumulativeAnswer = "";
  const onAnswerDelta = (chunk: string): void => {
    if (!chunk) {
      return;
    }
    cumulativeAnswer += chunk;
    const snapshot = cumulativeAnswer;
    deps.patchActiveConversation((c) =>
      replacePlaceholder(c, placeholderId, (m) => ({
        ...m,
        parts: [{ type: "text", text: snapshot }]
      }))
    );
  };

  try {
    const response = await fetchImpl("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        message: text,
        context: {
          sessionKey: snapshotAtSend.sessionKey,
          driverNumber: snapshotAtSend.driverNumber
        }
      })
    });

    if (!response.ok && !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream")) {
      const data = (await response.json()) as ChatApiResponse;
      const err =
        data.error != null
          ? `Request failed: ${data.error}${data.requestId ? ` (request_id=${data.requestId})` : ""}`
          : `Request failed with status ${response.status}`;
      deps.setResolved(data.requestId ? { requestId: data.requestId } : null);
      deps.patchActiveConversation((c) =>
        replacePlaceholder(c, placeholderId, (m) => ({
          ...m,
          parts: [{ type: "text", text: err }]
        }))
      );
      return;
    }

    const data = await consumeChatStream(response, { onAnswerDelta });

    const finalParts = deps.mapResponseToParts(data);
    const dr = deps.deriveResolved(data);
    deps.setResolved(dr);
    const nextCtx: ComposerContext = {
      sessionKey: dr.sessionKey ?? snapshotAtSend.sessionKey,
      sessionLabel: dr.sessionLabel ?? snapshotAtSend.sessionLabel,
      driverNumber: dr.driverNumbers?.[0] ?? snapshotAtSend.driverNumber
    };
    deps.setComposerCtx(nextCtx);
    deps.patchActiveConversation((c) => {
      const next = replacePlaceholder(c, placeholderId, (m) => ({
        ...m,
        parts: finalParts
      }));
      return {
        ...next,
        updatedAt: assistantTime,
        lastResolved: {
          sessionKey: dr.sessionKey,
          sessionLabel: dr.sessionLabel,
          driverNumbers: dr.driverNumbers,
          resolutionStatus: dr.resolutionStatus,
          needsClarification: dr.needsClarification,
          requestId: dr.requestId
        },
        contextSnapshot: nextCtx
      };
    });
  } catch {
    deps.patchActiveConversation((c) =>
      replacePlaceholder(c, placeholderId, (m) => ({
        ...m,
        parts: [{ type: "text", text: "Unable to process this request right now." }]
      }))
    );
  }
}
