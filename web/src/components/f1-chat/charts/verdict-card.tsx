"use client"

interface VerdictCardProps {
  verdict: {
    label: "YES" | "NO"
    color?: string
    summary: string
  }
}

/**
 * vNext verdict PILL (deck): a compact horizontal badge — status dot + YES/NO
 * label + the one-line "why" — instead of the old wall-sized 6xl word. Reads
 * as "answer at a glance", not a scoreboard.
 */
export function VerdictCard({ verdict }: VerdictCardProps) {
  const isYes = verdict.label === "YES"
  const accent = verdict.color || (isYes ? "hsl(var(--semantic-positive))" : "hsl(var(--semantic-negative))")

  return (
    <div
      className="flex items-center gap-3.5 rounded-xl border px-4 py-3"
      style={{
        // 12%-tint fill + a stronger edge in the verdict's own color.
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`
      }}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full text-[15px] font-bold"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 22%, transparent)`, color: accent }}
      >
        {isYes ? "✓" : "✕"}
      </span>
      <div className="min-w-0">
        <span
          className="font-mono text-sm font-bold uppercase tracking-[0.12em]"
          style={{ color: accent }}
        >
          {verdict.label}
        </span>
        <p className="mt-0.5 text-[13px] md:text-sm leading-snug text-foreground/85">{verdict.summary}</p>
      </div>
    </div>
  )
}
