"use client";

import { useId, useState } from "react";

type CollapsibleBlockProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  variant?: "default" | "code";
};

export function CollapsibleBlock({
  title,
  defaultOpen = false,
  children,
  variant = "default"
}: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface-secondary">
      <button
        type="button"
        id={`${id}-btn`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 border-0 bg-transparent px-3 text-left text-[13px] font-medium text-ink-secondary hover:bg-surface-hover"
      >
        <span>{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-btn`}
          className={
            variant === "code"
              ? "border-t border-border-subtle px-3 py-2.5"
              : "border-t border-border-subtle px-3 py-2.5 text-[13px] text-ink-secondary"
          }
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
