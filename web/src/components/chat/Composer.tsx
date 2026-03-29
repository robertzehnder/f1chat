"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  loading,
  context,
  onContextChange
}: ComposerProps) {
  const [draftSession, setDraftSession] = useState("");
  const [draftDriver, setDraftDriver] = useState("");
  const [showContextRow, setShowContextRow] = useState(false);
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

  function applyDraftContext() {
    const next = { ...context };
    if (draftSession.trim() !== "") {
      const sk = Number(draftSession.trim());
      if (Number.isFinite(sk)) {
        next.sessionKey = sk;
        next.sessionLabel = undefined;
      }
    }
    if (draftDriver.trim() !== "") {
      const dn = Number(draftDriver.trim());
      if (Number.isFinite(dn)) {
        next.driverNumber = dn;
      }
    }
    onContextChange(next);
    setDraftSession("");
    setDraftDriver("");
    setShowContextRow(false);
  }

  function clearSession() {
    onContextChange({ ...context, sessionKey: undefined, sessionLabel: undefined });
  }

  function clearDriver() {
    onContextChange({ ...context, driverNumber: undefined });
  }

  return (
    <div className="border-t border-border bg-white px-4 py-4">
      <form onSubmit={handleFormSubmit} className="mx-auto flex max-w-[720px] flex-col gap-2">
        {/* Context chips */}
        <div className="flex flex-wrap items-center gap-2">
          {context.sessionKey != null ? (
            <button
              type="button"
              onClick={clearSession}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs text-ink-secondary shadow-sm hover:bg-surface-hover"
            >
              <span>Session · {context.sessionLabel ?? context.sessionKey}</span>
              <span className="text-ink-tertiary">×</span>
            </button>
          ) : null}
          {context.driverNumber != null ? (
            <button
              type="button"
              onClick={clearDriver}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs text-ink-secondary shadow-sm hover:bg-surface-hover"
            >
              <span>Driver · {context.driverNumber}</span>
              <span className="text-ink-tertiary">×</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowContextRow((s) => !s)}
            className="rounded-full border border-dashed border-border bg-transparent px-3 py-1 text-xs text-ink-tertiary hover:border-border hover:bg-surface-hover hover:text-ink-secondary"
            style={{ borderStyle: showContextRow ? "solid" : "dashed" }}
          >
            {showContextRow ? "Hide context" : "+ Session / driver"}
          </button>
        </div>

        {/* Context editing row */}
        {showContextRow ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-ink-secondary">
              Session key
              <input
                className="w-32 rounded-sm border border-border bg-white px-2.5 py-1.5 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                inputMode="numeric"
                value={draftSession}
                onChange={(e) => setDraftSession(e.target.value)}
                placeholder="e.g. 9839"
              />
            </label>
            <label className="grid gap-1 text-xs text-ink-secondary">
              Driver #
              <input
                className="w-24 rounded-sm border border-border bg-white px-2.5 py-1.5 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                inputMode="numeric"
                value={draftDriver}
                onChange={(e) => setDraftDriver(e.target.value)}
                placeholder="e.g. 1"
              />
            </label>
            <button
              type="button"
              onClick={applyDraftContext}
              className="rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Apply
            </button>
          </div>
        ) : null}

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
