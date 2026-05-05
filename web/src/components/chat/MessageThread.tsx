"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chatTypes";
import { UserMessage } from "@/components/chat/UserMessage";
import { AssistantMessage } from "@/components/chat/AssistantMessage";

type MessageThreadProps = {
  messages: ChatMessage[];
  loading: boolean;
  onFollowUp?: (prompt: string) => void;
  onSuggestedPrompt?: (prompt: string) => void;
};

const SUGGESTED_PROMPTS = [
  "What was Norris's apex speed through Eau Rouge during the 2025 Belgian Grand Prix?",
  "Compare Verstappen and Hamilton through the Suzuka esses (Turns 7-9) at the 2025 Japanese GP — entry, apex, exit",
  "How many on-track overtakes happened during the 2025 Singapore Grand Prix?",
  "On which lap did the McLarens make the inters-to-slicks crossover at the 2025 British GP?"
];

export function MessageThread({ messages, loading, onFollowUp, onSuggestedPrompt }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const empty = messages.length === 0 && !loading;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-8">
      {empty ? (
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 pt-20 text-center">
          <h2 className="m-0 text-xl font-semibold tracking-tight text-ink">
            What would you like to analyze?
          </h2>
          <p className="m-0 text-sm text-ink-secondary">
            Ask about lap times, corner speeds, tyre strategy, or any 2025 F1 data.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onSuggestedPrompt?.(p) ?? onFollowUp?.(p)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
          {messages.map((m) =>
            m.role === "user" ? (
              <UserMessage key={m.id} text={m.text} />
            ) : (
              <AssistantMessage key={m.id} parts={m.parts} onFollowUp={onFollowUp} />
            )
          )}
          {loading ? (
            <div className="flex items-center gap-2.5 pl-4 text-sm text-ink-secondary">
              <span
                className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-accent"
                aria-hidden="true"
              />
              Thinking…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
