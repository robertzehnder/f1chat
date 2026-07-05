"use client"

import { cn } from "@/lib/utils"

export interface ClarificationOption {
  sessionKey: number
  sessionType: string
  label: string
  resolvedQuery: string
  primary: boolean
}

interface ClarificationCardProps {
  prompt: string
  options: ClarificationOption[]
  onResolve: (resolvedQuery: string) => void
}

/**
 * B17: session disambiguation choice card. Renders the clarification prompt
 * plus one-tap option buttons (session type + readable venue/year). Never
 * shows a raw session_key as the visible label. The highest-confidence
 * candidate is styled as the primary action; the rest are secondary. Choosing
 * an option re-sends the resolved query through the normal chat submit path.
 */
export function ClarificationCard({ prompt, options, onResolve }: ClarificationCardProps) {
  if (options.length === 0) return null
  return (
    <div className="mt-1">
      <p className="font-mono text-[10px] md:text-[10.5px] uppercase tracking-[0.16em] text-section-label mb-2">
        Which session?
      </p>
      <p className="text-[13px] md:text-sm text-foreground/80 leading-relaxed mb-3">{prompt}</p>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.sessionKey}
            type="button"
            onClick={() => onResolve(opt.resolvedQuery)}
            className={cn(
              "group flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
              opt.primary
                ? "border-primary/60 bg-primary/10 hover:bg-primary/15"
                : "border-border/60 bg-surface-raised/40 hover:bg-surface-raised/70"
            )}
          >
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-[13px] md:text-sm font-semibold leading-tight",
                  opt.primary ? "text-foreground" : "text-foreground/90"
                )}
              >
                {opt.sessionType}
              </span>
              <span className="block truncate font-mono text-[10px] md:text-[11px] text-muted-foreground tracking-wide">
                {opt.label}
              </span>
            </span>
            {opt.primary ? (
              <span className="shrink-0 rounded-md bg-primary/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-red-text">
                Most likely
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="shrink-0 text-muted-foreground/60 group-hover:text-foreground/80 transition-colors"
              >
                →
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
