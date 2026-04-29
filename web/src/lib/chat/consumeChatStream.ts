import type { ChatApiResponse } from "@/lib/chatTypes";

export type ConsumeChatStreamHooks = {
  onAnswerDelta?(text: string): void;
  onReasoningDelta?(text: string): void;
};

type StreamFrame = { event: string; data: unknown };

function parseFrame(block: string): StreamFrame | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice("event: ".length);
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice("data: ".length));
    }
  }
  if (!event && dataLines.length === 0) {
    return null;
  }
  let data: unknown = null;
  if (dataLines.length > 0) {
    const joined = dataLines.join("\n");
    try {
      data = JSON.parse(joined);
    } catch {
      data = joined;
    }
  }
  return { event, data };
}

function getDeltaText(data: unknown): string {
  if (data && typeof data === "object" && "text" in (data as Record<string, unknown>)) {
    const t = (data as Record<string, unknown>).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

export async function consumeChatStream(
  response: Response,
  hooks: ConsumeChatStreamHooks
): Promise<ChatApiResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/event-stream")) {
    const payload = (await response.json()) as ChatApiResponse;
    if (typeof payload.answer === "string" && payload.answer.length > 0) {
      hooks.onAnswerDelta?.(payload.answer);
    }
    return payload;
  }

  const body = response.body;
  if (!body) {
    throw new Error("consumeChatStream: SSE response has no body");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatApiResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx !== -1) {
        const block = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const frame = parseFrame(block);
        if (frame) {
          if (frame.event === "answer_delta") {
            hooks.onAnswerDelta?.(getDeltaText(frame.data));
          } else if (frame.event === "reasoning_delta") {
            hooks.onReasoningDelta?.(getDeltaText(frame.data));
          } else if (frame.event === "final") {
            finalPayload = frame.data as ChatApiResponse;
          } else if (frame.event === "error") {
            const message =
              frame.data && typeof frame.data === "object" && "message" in (frame.data as Record<string, unknown>)
                ? String((frame.data as Record<string, unknown>).message ?? "stream error")
                : "stream error";
            throw new Error(message);
          }
        }
        sepIdx = buffer.indexOf("\n\n");
      }
    }
    if (done) {
      break;
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    const frame = parseFrame(buffer);
    if (frame) {
      if (frame.event === "answer_delta") {
        hooks.onAnswerDelta?.(getDeltaText(frame.data));
      } else if (frame.event === "reasoning_delta") {
        hooks.onReasoningDelta?.(getDeltaText(frame.data));
      } else if (frame.event === "final") {
        finalPayload = frame.data as ChatApiResponse;
      } else if (frame.event === "error") {
        const message =
          frame.data && typeof frame.data === "object" && "message" in (frame.data as Record<string, unknown>)
            ? String((frame.data as Record<string, unknown>).message ?? "stream error")
            : "stream error";
        throw new Error(message);
      }
    }
  }

  if (!finalPayload) {
    throw new Error("consumeChatStream: stream closed before a final frame was received");
  }
  return finalPayload;
}
