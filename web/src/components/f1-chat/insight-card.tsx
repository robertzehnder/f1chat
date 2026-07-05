"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { FollowUpChips } from "./suggestion-chips"
import { ChartRenderer, MetricGridRenderer, HeroScalar, VerdictCard, CompositeCard, NoDataCard } from "./charts"
import { ClarificationCard, type ClarificationOption } from "./charts/clarification-card"
import { CornerMiniMap } from "./charts/corner-mini-map"
import { ActivityLog } from "./activity-log"
import type { ChartSpec, Metric } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface InsightCardProps {
  title?: string
  subtitle?: string
  /** vNext: promoted one-line answer shown ABOVE the tiles ("answer at a glance"). */
  atAGlance?: string
  /** A1: corner-metrics card → mini track-map highlighting one corner. */
  cornerMap?: { circuit: string; corner_number?: number; corner_label?: string }
  body: string
  metrics?: Metric[]
  chart?: ChartSpec
  takeaways?: string[]
  relatedQuestions?: string[]
  onFollowUp?: (question: string) => void
  /** B17: session-disambiguation choice card. When present, renders one-tap
   *  option buttons; picking one calls onResolve with the resolved re-send. */
  clarification?: {
    prompt: string
    options: ClarificationOption[]
  }
  onResolve?: (resolvedQuery: string) => void
  className?: string
  // New mock types
  hero?: {
    value: string
    label: string
    context?: string
  }
  verdict?: {
    label: "YES" | "NO"
    color?: string
    summary: string
  }
  composite?: Array<{
    type: string
    title?: string
    x_label?: string
    y_label?: string
    series?: Array<{ name: string; color: string; values: number[] }>
    vertical_markers?: Array<{ x: number; label: string }>
    metrics?: Metric[]
  }>
  what_we_have?: string[]
  tone?: "normal" | "muted"
  // Backend-produced fields surfaced for the live SSE chat path.
  // /mock fixtures leave these undefined; production page populates them.
  sql?: string
  rows?: Record<string, unknown>[]
  rowCount?: number
  elapsedMs?: number
  truncated?: boolean
  /** Cumulative reasoning_delta — rendered as <details> below activity log. */
  reasoning?: string
  /** Drives "Working…" treatment for the activity panel. */
  streaming?: boolean
  /** Structured stage-by-stage log (synthetic during stream, real after). */
  activity?: import("@/lib/activityLog").ActivityEvent[]
}

export function InsightCard({
  title,
  subtitle,
  atAGlance,
  cornerMap,
  body,
  metrics,
  chart,
  takeaways,
  relatedQuestions,
  onFollowUp,
  clarification,
  onResolve,
  className,
  hero,
  verdict,
  composite,
  what_we_have,
  tone = "normal",
  sql,
  rows,
  rowCount,
  elapsedMs,
  truncated,
  reasoning,
  streaming,
  activity
}: InsightCardProps) {
  const isMuted = tone === "muted"
  // Don't show the empty card while streaming with no content yet — render
  // a small "Thinking…" affordance so the UI feels alive immediately.
  const hasContent =
    !!body || !!hero || !!verdict || !!chart || !!metrics?.length || !!composite || !!what_we_have
  return (
    <Card className={cn("border-border/50 bg-card/50 backdrop-blur overflow-hidden w-full", className)}>
      {(title || subtitle) && (
        <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
          {title && (
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  "size-2.5 rounded-full mt-1.5 shrink-0",
                  isMuted
                    ? "bg-muted-foreground"
                    : "bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.65)]",
                  !isMuted && streaming && "animate-live-pulse"
                )}
              />
              <h3 className="font-semibold text-foreground text-base md:text-lg leading-tight tracking-tight">{title}</h3>
            </div>
          )}
          {subtitle && (
            <p className="font-mono text-[10px] md:text-[11px] text-muted-foreground ml-5 tracking-wide">{subtitle}</p>
          )}
        </CardHeader>
      )}
      <CardContent className={cn("px-3 md:px-6 pb-3 md:pb-6", !title && !subtitle && "pt-3 md:pt-5")}>
        {/*
          Activity log — structured stage-by-stage trace.
          During streaming: synthetic phases cycling (page-level handler).
          After stream closes: real activity from response.runtime.
        */}
        {activity && activity.length > 0 && <ActivityLog events={activity} live={streaming} />}

        {/* Reasoning — collapsed disclosure under the activity log when present. */}
        {reasoning && !streaming && (
          <details className="mb-3 text-[11px] md:text-xs">
            <summary className="cursor-pointer font-mono uppercase tracking-[0.16em] text-section-label hover:text-foreground/80">
              Reasoning &amp; query
              {(rowCount != null || elapsedMs != null) && (
                <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                  — {rowCount != null ? `${rowCount} rows` : ""}
                  {rowCount != null && elapsedMs != null ? " · " : ""}
                  {elapsedMs != null ? `${elapsedMs}ms` : ""}
                </span>
              )}
            </summary>
            <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md bg-secondary/30 px-3 py-2 font-sans text-[12px] leading-relaxed text-foreground/70">
              {reasoning}
            </pre>
          </details>
        )}

        {/* Fallback "Working…" line when no activity log + no body content yet. */}
        {streaming && !hasContent && !activity?.length && (
          <div className="flex items-center gap-2 py-2">
            <span className="size-2 rounded-full bg-primary animate-live-pulse" aria-hidden="true" />
            <span className="text-[12px] md:text-sm text-muted-foreground italic">Working…</span>
          </div>
        )}

        {/* Clarification choice card (B17) — session disambiguation */}
        {clarification && clarification.options.length > 0 && onResolve && (
          <ClarificationCard
            prompt={clarification.prompt}
            options={clarification.options}
            onResolve={onResolve}
          />
        )}

        {/* Hero Scalar (M01) */}
        {hero && <HeroScalar hero={hero} />}

        {/* Yes/No Verdict (M02) */}
        {verdict && <VerdictCard verdict={verdict} />}

        {/* vNext: answer at a glance — promoted one-line answer above the tiles */}
        {atAGlance && (
          <div className={cn(hero || verdict ? "mt-4" : "")}>
            <p className="font-mono text-[10px] md:text-[10.5px] uppercase tracking-[0.16em] text-section-label mb-1.5">
              Answer at a glance
            </p>
            <p className="text-[15px] md:text-[19px] font-semibold leading-snug tracking-tight text-foreground">
              {atAGlance}
            </p>
          </div>
        )}

        {/* Narrative */}
        {body && (
          <p className={cn("text-[13px] md:text-sm text-foreground/80 leading-relaxed", atAGlance && "mt-3")}>{body}</p>
        )}
        
        {/* No-data card (M21) */}
        {what_we_have && <NoDataCard what_we_have={what_we_have} />}
        
        {/* Metrics Grid */}
        {metrics && metrics.length > 0 && (
          <div className="mt-4 md:mt-5">
            <MetricGridRenderer metrics={metrics} />
          </div>
        )}

        {/* A1: corner-on-map — the single corner pinned on the real outline. */}
        {cornerMap?.circuit && (
          <div className="mt-3">
            <CornerMiniMap
              circuit={cornerMap.circuit}
              cornerNumber={cornerMap.corner_number}
              cornerLabel={cornerMap.corner_label}
            />
          </div>
        )}
        
        {/* Chart Visualization */}
        {chart && (
          <div className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border/30">
            <ChartRenderer chart={chart} />
          </div>
        )}
        
        {/* Composite multi-chart (M20) */}
        {composite && (
          <div className="mt-5 pt-4 border-t border-border/30">
            <CompositeCard composite={composite} />
          </div>
        )}
        
        {/* Key Takeaways */}
        {takeaways && takeaways.length > 0 && (
          <div className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border/30">
            <p className="font-mono text-[10px] md:text-[10.5px] text-section-label mb-2 md:mb-3 uppercase tracking-[0.16em]">Key Takeaways</p>
            <ul className="space-y-1.5 md:space-y-2">
              {takeaways.map((takeaway, index) => (
                <li key={index} className="text-[13px] md:text-sm text-foreground/80 flex items-start gap-2">
                  <span className="text-red-text mt-0.5 font-bold">–</span>
                  <span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* SQL — collapsible (live chat only; fixtures leave sql undefined) */}
        {sql && (
          <details className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border/30">
            <summary className="cursor-pointer font-mono text-[10px] md:text-[10.5px] text-section-label uppercase tracking-[0.16em] hover:text-foreground/80">
              SQL
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-secondary/50 p-3 text-[11px] md:text-xs text-foreground/80 font-mono">
              <code>{sql}</code>
            </pre>
          </details>
        )}

        {/* Result Table — first 50 rows */}
        {rows && rows.length > 0 && (
          <div className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border/30">
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[10px] md:text-[10.5px] text-section-label uppercase tracking-[0.16em]">
                Result {rowCount != null ? `(${rowCount} rows` : `(${rows.length} rows`}
                {elapsedMs != null ? ` · ${elapsedMs}ms` : ""}
                {")"}
              </p>
            </div>
            <div className="overflow-auto rounded-md border border-border/30 max-h-[360px]">
              <table className="w-full border-collapse text-[12px] md:text-[13px] font-mono">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                  <tr>
                    {Object.keys(rows[0]).map((col) => (
                      <th
                        key={col}
                        className="px-2.5 py-2 text-left font-sans text-[10px] md:text-xs font-semibold uppercase text-muted-foreground"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((row, idx) => (
                    <tr
                      key={idx}
                      className={cn(
                        "border-t border-border/30",
                        idx % 2 === 0 ? "bg-transparent" : "bg-secondary/20"
                      )}
                    >
                      {Object.keys(rows[0]).map((col) => (
                        <td key={col} className="whitespace-nowrap px-2.5 py-1.5 text-foreground/85">
                          {row[col] === null || row[col] === undefined ? "" : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {truncated && rowCount != null && rowCount > rows.length && (
              <p className="mt-1.5 text-[10px] md:text-xs text-muted-foreground">
                Showing first {rows.length} of {rowCount} rows
              </p>
            )}
          </div>
        )}

        {/* Follow-up Questions */}
        {relatedQuestions && onFollowUp && (
          <div className="mt-5">
            <FollowUpChips
              questions={relatedQuestions}
              onSelect={onFollowUp}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Re-export for backwards compatibility
export { InsightCard as default }
