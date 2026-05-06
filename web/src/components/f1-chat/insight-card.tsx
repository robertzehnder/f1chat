"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { FollowUpChips } from "./suggestion-chips"
import { ChartRenderer, MetricGridRenderer, HeroScalar, VerdictCard, CompositeCard, NoDataCard } from "./charts"
import type { ChartSpec, Metric } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface InsightCardProps {
  title?: string
  subtitle?: string
  body: string
  metrics?: Metric[]
  chart?: ChartSpec
  takeaways?: string[]
  relatedQuestions?: string[]
  onFollowUp?: (question: string) => void
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
}

export function InsightCard({
  title,
  subtitle,
  body,
  metrics,
  chart,
  takeaways,
  relatedQuestions,
  onFollowUp,
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
  truncated
}: InsightCardProps) {
  const isMuted = tone === "muted"
  return (
    <Card className={cn("border-border/50 bg-card/50 backdrop-blur overflow-hidden w-full", className)}>
      {(title || subtitle) && (
        <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
          {title && (
            <div className="flex items-start gap-2">
              <div className={cn("size-2 rounded-full mt-2 shrink-0", isMuted ? "bg-muted-foreground" : "bg-[#E10600]")} />
              <h3 className="font-semibold text-foreground text-base md:text-lg leading-tight">{title}</h3>
            </div>
          )}
          {subtitle && (
            <p className="text-[10px] md:text-xs text-muted-foreground ml-4">{subtitle}</p>
          )}
        </CardHeader>
      )}
      <CardContent className={cn("px-3 md:px-6 pb-3 md:pb-6", !title && !subtitle && "pt-3 md:pt-5")}>
        {/* Hero Scalar (M01) */}
        {hero && <HeroScalar hero={hero} />}
        
        {/* Yes/No Verdict (M02) */}
        {verdict && <VerdictCard verdict={verdict} />}
        
        {/* Narrative */}
        <p className="text-[13px] md:text-sm text-foreground/90 leading-relaxed">{body}</p>
        
        {/* No-data card (M21) */}
        {what_we_have && <NoDataCard what_we_have={what_we_have} />}
        
        {/* Metrics Grid */}
        {metrics && metrics.length > 0 && (
          <div className="mt-4 md:mt-5">
            <MetricGridRenderer metrics={metrics} />
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
            <p className="text-[10px] md:text-xs font-medium text-muted-foreground mb-2 md:mb-3 uppercase tracking-wide">Key Takeaways</p>
            <ul className="space-y-1.5 md:space-y-2">
              {takeaways.map((takeaway, index) => (
                <li key={index} className="text-[13px] md:text-sm text-foreground/80 flex items-start gap-2">
                  <span className="text-[#E10600] mt-0.5 font-bold">-</span>
                  <span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* SQL — collapsible (live chat only; fixtures leave sql undefined) */}
        {sql && (
          <details className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border/30">
            <summary className="cursor-pointer text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground/80">
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
              <p className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wide">
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
