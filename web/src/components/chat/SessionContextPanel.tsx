"use client";

import type { ResolvedSessionContext } from "@/lib/chatContext";
import type { ComposerContext } from "@/components/chat/Composer";

type SessionContextPanelProps = {
  resolved: ResolvedSessionContext | null;
  composerContext: ComposerContext;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export function SessionContextPanel({
  resolved,
  composerContext,
  collapsed,
  onToggleCollapse
}: SessionContextPanelProps) {
  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-border bg-surface-secondary py-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-sm border border-border bg-white px-1.5 py-3 text-xs text-ink-tertiary hover:bg-surface-hover hover:text-ink-secondary"
          title="Show context"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M6.5 2L3.5 5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-border bg-surface-secondary">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary">
          Context
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-sm border-0 bg-transparent px-2 py-1 text-xs text-ink-tertiary hover:bg-surface-hover hover:text-ink-secondary"
          title="Hide panel"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M3.5 2L6.5 5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <section>
          <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary">
            Active pins
          </h3>
          <dl className="m-0 space-y-1.5 font-mono text-[13px] text-ink-secondary">
            <div className="flex justify-between gap-2">
              <dt>session_key</dt>
              <dd className="m-0 text-ink">{composerContext.sessionKey ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>driver</dt>
              <dd className="m-0 text-ink">{composerContext.driverNumber ?? "—"}</dd>
            </div>
            {composerContext.sessionLabel ? (
              <div className="pt-1">
                <dt className="text-ink-tertiary">label</dt>
                <dd className="m-0 text-ink">{composerContext.sessionLabel}</dd>
              </div>
            ) : null}
          </dl>
        </section>
        <section>
          <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary">
            Last resolution
          </h3>
          {!resolved || (!resolved.sessionKey && !resolved.driverNumbers?.length && !resolved.requestId) ? (
            <p className="m-0 text-xs text-ink-tertiary">No run yet in this thread.</p>
          ) : (
            <dl className="m-0 space-y-1.5 font-mono text-[13px] text-ink-secondary">
              {resolved.requestId ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-tertiary">request_id</dt>
                  <dd className="m-0 max-w-[140px] truncate text-ink" title={resolved.requestId}>
                    {resolved.requestId}
                  </dd>
                </div>
              ) : null}
              {resolved.resolutionStatus ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-tertiary">status</dt>
                  <dd className="m-0 text-ink">{resolved.resolutionStatus}</dd>
                </div>
              ) : null}
              {resolved.needsClarification ? (
                <p className="m-0 text-xs text-semantic-warning">Needs clarification</p>
              ) : null}
              {resolved.sessionKey != null ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-tertiary">session</dt>
                  <dd className="m-0 text-right text-ink">
                    {resolved.sessionLabel ?? resolved.sessionKey}
                  </dd>
                </div>
              ) : null}
              {resolved.driverNumbers?.length ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-tertiary">drivers</dt>
                  <dd className="m-0 text-ink">{resolved.driverNumbers.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>
      </div>
    </aside>
  );
}
