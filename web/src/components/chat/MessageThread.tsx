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
  "Compare lap pace for the top 3 in the last race",
  "Which drivers pitted under the safety car?",
  "Show tyre strategies for the race winner"
];

export function MessageThread({ messages, loading, onFollowUp, onSuggestedPrompt }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const empty = messages.length === 0 && !loading;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-8">
      {empty ? (
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 pt-20 text-center">
          <h2 className="m-0 text-xl font-semibold tracking-tight text-ink">
            What would you like to analyze?
          </h2>
          <p className="m-0 text-sm text-ink-secondary">
            Ask about lap times, strategy, race pace, or any F1 data in your warehouse.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onSuggestedPrompt?.(p) ?? onFollowUp?.(p)}
                className="rounded-full border border-border bg-white px-3.5 py-1.5 text-xs text-ink-secondary shadow-sm transition-colors hover:bg-surface-hover hover:text-ink"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
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
