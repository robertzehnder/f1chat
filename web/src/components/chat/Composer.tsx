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

  // Phase 26 UI: dark composer with a rounded textarea and a
  // round red send button (F1 Insights design).
  return (
    <div className="bg-canvas px-6 pb-6 pt-2">
      <form onSubmit={handleFormSubmit} className="mx-auto flex w-full max-w-[920px] flex-col gap-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about lap times, strategy, driver comparisons…"
            rows={1}
            disabled={loading}
            className="w-full resize-none rounded-2xl border border-border bg-surface py-4 pl-5 pr-16 text-[15px] text-ink placeholder:text-ink-tertiary focus:border-ink-tertiary focus:outline-none disabled:opacity-60"
            style={{ minHeight: "56px", maxHeight: "180px" }}
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            {loading ? (
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        <p className="m-0 text-center text-xs text-ink-tertiary">Powered by OpenF1 data. Press Enter to send.</p>
      </form>
    </div>
  );
}
