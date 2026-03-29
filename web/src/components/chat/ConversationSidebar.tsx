"use client";

import Link from "next/link";
import type { Conversation } from "@/lib/chatTypes";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onTogglePin,
  onDelete
}: ConversationSidebarProps) {
  const sorted = [...conversations].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <aside className="flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-border bg-canvas">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">
          OpenF1
        </span>
        <button
          type="button"
          onClick={onNew}
          className="rounded-sm border border-border bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-hover"
        >
          New chat
        </button>
      </div>
      <ul className="m-0 list-none flex-1 overflow-y-auto p-2">
        {sorted.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id} className="mb-0.5">
              <div
                className={`group flex rounded-sm ${
                  active
                    ? "border-l-2 border-l-accent bg-accent-soft"
                    : "border-l-2 border-l-transparent hover:bg-surface-hover"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    {c.pinned ? (
                      <span className="inline-block size-1.5 shrink-0 rounded-full bg-accent" aria-label="Pinned" />
                    ) : null}
                    <span className={`truncate text-sm text-ink ${active ? "font-medium" : ""}`}>
                      {c.title}
                    </span>
                  </div>
                  <span className="text-xs text-ink-tertiary">{formatTime(c.updatedAt)}</span>
                </button>
                <div className="flex shrink-0 flex-col justify-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    title={c.pinned ? "Unpin" : "Pin"}
                    onClick={() => onTogglePin(c.id)}
                    className="rounded border-0 bg-transparent px-1 text-xs text-ink-tertiary hover:bg-surface-hover hover:text-ink-secondary"
                  >
                    {c.pinned ? "−" : "●"}
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => onDelete(c.id)}
                    className="rounded border-0 bg-transparent px-1 text-xs text-ink-tertiary hover:bg-semantic-error-soft hover:text-semantic-error"
                  >
                    ×
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border p-2 text-xs text-ink-secondary">
        <Link href="/sessions" className="block rounded-sm px-2.5 py-2 hover:bg-surface-hover hover:text-ink">
          Sessions
        </Link>
        <Link href="/catalog" className="block rounded-sm px-2.5 py-2 hover:bg-surface-hover hover:text-ink">
          Schema catalog
        </Link>
        <Link href="/telemetry" className="block rounded-sm px-2.5 py-2 hover:bg-surface-hover hover:text-ink">
          Telemetry
        </Link>
        <Link href="/" className="block rounded-sm px-2.5 py-2 hover:bg-surface-hover hover:text-ink">
          Home
        </Link>
      </div>
    </aside>
  );
}
