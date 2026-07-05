"use client"

import type { Metric } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

// Defensive split for legacy data where the model packed qualifier text
// into `unit` (e.g. "s — Antonelli (lap 3)"). Cached synthesis results
// pre-date the validator-side fix, so the render layer handles it too.
// A unit token is short (≤ 8 chars) and contains no whitespace before
// any dash; anything past the dash becomes context.
function splitUnitAndContext(metric: Metric): { unit?: string; context?: string } {
  const rawUnit = metric.unit?.trim()
  const rawContext = metric.context?.trim()
  if (!rawUnit) return { unit: undefined, context: rawContext }
  const m = /^(.{1,8}?)\s+[—–-]\s+(.+)$/.exec(rawUnit)
  if (!m) return { unit: rawUnit, context: rawContext }
  return {
    unit: m[1].trim(),
    context: rawContext || m[2].trim(),
  }
}

interface MetricGridProps {
  metrics: Metric[]
  className?: string
}

export function MetricGrid({ metrics, className }: MetricGridProps) {
  // On mobile (< 3 metrics): show all in a row
  // On mobile (>= 3 metrics): 2 columns
  // On desktop: up to 4 columns
  const colCount = Math.min(metrics.length, 4)
  
  return (
    <div 
      className={cn(
        "grid gap-2 md:gap-3",
        // Mobile: 2 cols if 3+ metrics, else match count
        metrics.length >= 3 ? "grid-cols-2" : `grid-cols-${Math.min(metrics.length, 2)}`,
        // Desktop: up to 4 columns
        colCount === 3 && "md:grid-cols-3",
        colCount >= 4 && "md:grid-cols-4",
        className
      )}
    >
      {metrics.map((metric, index) => {
        const { unit, context } = splitUnitAndContext(metric)
        return (
          <div
            key={index}
            className={cn(
              "rounded-lg p-3 md:p-4 text-center overflow-hidden flex flex-col justify-center min-h-[96px]",
              metric.emphasis
                ? "bg-primary/10 border border-primary/30"
                : "bg-surface-raised border border-border/60"
            )}
          >
            {/* Value + pure unit on one line — qualifier always pushes to its own line. */}
            <p className="font-mono text-xl md:text-3xl font-bold text-foreground tracking-tight leading-tight tabular-nums truncate">
              {metric.value}
              {unit && (
                <span className="font-mono text-xs md:text-sm font-normal text-muted-foreground ml-1.5">
                  {unit}
                </span>
              )}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1.5 truncate">{metric.label}</p>
            {context && (
              <p
                className={cn(
                  "text-[10px] md:text-[11px] mt-0.5 truncate",
                  metric.emphasis ? "text-red-text/90" : "text-muted-foreground/70"
                )}
              >
                {context}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
