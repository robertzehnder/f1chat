"use client";

import { FormEvent, useCallback, useEffect, useRef } from "react";
import type { ChatContext } from "@/lib/chatTypes";

export type ComposerContext = ChatContext & {
  sessionLabel?: string;
};

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  context: ComposerContext;
  onContextChange: (ctx: ComposerContext) => void;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  loading
  // Phase 26 UI: `context` and `onContextChange` are still on the
  // prop type for callers but the chip row that exposed them was
  // removed. Context is set/cleared via the side CONTEXT panel.
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [value, autoGrow]);

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || loading) return;
    onSubmit();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !loading) onSubmit();
    }
  }

  return (
    <div className="border-t border-border bg-white px-4 py-4">
      <form onSubmit={handleFormSubmit} className="mx-auto flex max-w-[720px] flex-col gap-2">
        {/* Phase 26 UI: session/driver context chips removed at user
            request — they were blocking info above the input row.
            Context is still tracked in state and can be set via the
            CONTEXT side panel pins; just no chip-row in the composer. */}

        {/* Input + send */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about lap times, strategy, intervals…"
            rows={1}
            disabled={loading}
            className="w-full resize-none rounded-lg border border-border bg-white py-3 pl-4 pr-14 text-sm text-ink shadow-md placeholder:text-ink-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
            style={{ minHeight: "48px", maxHeight: "160px" }}
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="absolute bottom-2.5 right-2.5 flex size-9 items-center justify-center rounded-lg bg-accent text-white shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            {loading ? (
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        <p className="m-0 text-xs text-ink-tertiary">Enter to send · Shift+Enter for newline</p>
      </form>
    </div>
  );
}
