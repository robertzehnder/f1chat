"use client"

import { useMemo } from "react"
import type { ChartSpec, VenueCoverage } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { TrackMap, useTrackOutline } from "./track-map"

interface StatusGridChartProps {
  chart: ChartSpec
}

// Status tints follow the two-layer color rule: coverage status is a THEME
// semantic (not a team/compound domain color), so use hsl(var(--token)).
const STATUS_TINT: Record<VenueCoverage["status"], string> = {
  green: "hsl(var(--semantic-positive))",
  amber: "hsl(var(--accent-amber))",
  red: "hsl(var(--semantic-negative))"
}

const STATUS_LABEL: Record<VenueCoverage["status"], string> = {
  green: "Complete",
  amber: "Partial",
  red: "Gap"
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  full: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  partial: { bg: "bg-amber-500/20", text: "text-amber-400" },
  missing: { bg: "bg-red-500/20", text: "text-red-400" }
}

/** One venue tile: lazily fetches its own outline (useTrackOutline caches
 *  per circuit, and each tile mounts independently so the 24
 *  /api/track-outline requests fan out one-per-circuit). Renders a mini
 *  outline tinted by the venue's coverage status, with an Rn round label. */
function VenueTile({ venue }: { venue: VenueCoverage }) {
  const outline = useTrackOutline(venue.circuit)
  const tint = STATUS_TINT[venue.status]
  const roundLabel = venue.round !== undefined ? `R${venue.round}` : "—"

  return (
    <div
      className="flex flex-col items-center gap-1 rounded-lg border border-border/40 bg-surface-raised p-2"
      title={`${venue.location} — ${STATUS_LABEL[venue.status]} (${venue.gaps}/${venue.total} sessions with a weather gap)`}
    >
      <div className="flex w-full items-center justify-between px-0.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-section-label">
          {roundLabel}
        </span>
        <span className="size-2 rounded-full" style={{ backgroundColor: tint }} />
      </div>
      <div className="flex h-16 w-full items-center justify-center">
        {outline === undefined ? (
          <div className="size-full animate-pulse rounded bg-foreground/5" />
        ) : outline === null ? (
          <span className="size-3 rounded-full opacity-70" style={{ backgroundColor: tint }} />
        ) : (
          <TrackMap
            outline={outline}
            variant="mini"
            segments={[{ color: tint, label: STATUS_LABEL[venue.status] }]}
            className="h-16 w-auto max-w-full"
          />
        )}
      </div>
      <span className="w-full truncate text-center text-[10px] leading-tight text-foreground/80">
        {venue.location}
      </span>
    </div>
  )
}

function VenueGrid({ venues }: { venues: VenueCoverage[] }) {
  const allClear = useMemo(() => venues.every((v) => v.status === "green"), [venues])

  return (
    <div className="w-full space-y-3">
      {allClear && (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface-raised px-3 py-2 text-[13px] text-semantic-positive">
          <span className="font-semibold">All clear</span>
          <span className="text-foreground/70">
            every checked venue has full weather coverage across its telemetry sessions.
          </span>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {venues.map((v) => (
          <VenueTile key={v.circuit} venue={v} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-4 pt-1">
        {(Object.keys(STATUS_TINT) as VenueCoverage["status"][]).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="size-3 rounded" style={{ backgroundColor: STATUS_TINT[s] }} />
            <span className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatusGridChart({ chart }: StatusGridChartProps) {
  // Venue-grid mode: 24-circuit coverage grid of mini outlines.
  if (chart.venue_grid && chart.venues && chart.venues.length > 0) {
    return <VenueGrid venues={chart.venues} />
  }

  // Legacy session×datatype table.
  if (!chart.rows) return null

  const columns = Object.keys(chart.rows[0] || {}).filter(
    (k) => k !== "label" && k !== "session_key"
  )

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Session</th>
            {columns.map((col) => (
              <th key={col} className="text-center py-2 px-3 font-medium text-muted-foreground capitalize">
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, idx) => (
            <tr key={idx} className="border-b border-border/30">
              <td className="py-2 px-3 text-foreground font-medium">{row.label}</td>
              {columns.map((col) => {
                const status = row[col] as string
                const colors = STATUS_COLORS[status] || STATUS_COLORS.missing
                return (
                  <td key={col} className="py-2 px-3 text-center">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded text-xs font-medium",
                      colors.bg,
                      colors.text
                    )}>
                      {status}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex gap-4 mt-4 justify-center">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={cn("w-3 h-3 rounded", colors.bg)} />
            <span className="text-xs text-muted-foreground capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
