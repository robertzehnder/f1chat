"use client"

import type { ChartSpec, TimelineEvent } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { TrackMap, useTrackOutline } from "./track-map"

interface TimelineChartProps {
  chart: ChartSpec
  className?: string
}

const kindLabels: Record<string, string> = {
  track_limits: "Track Limits",
  multiple_track_limits: "Track Limits",
  forcing_off: "Forcing Off",
  leaving_track_advantage: "Left Track",
  unsafe_release: "Unsafe Release",
  speeding: "Speeding",
  pit_speeding: "Pit Speeding",
  pit_lane_infraction: "Pit Lane",
  collision: "Collision",
  false_start: "False Start",
  reprimand: "Reprimand",
  incident: "Incident",
  event: "Event"
}

// Kind → glyph. Kept as inline SVG so there is no icon-library dependency and
// the color follows currentColor. Grouped by broad category.
function kindGlyph(kind: string): string {
  const k = kind.toLowerCase()
  if (/collision|crash|contact/.test(k)) return "✖" // heavy multiply — crash
  if (/penalt|time|drive|speed/.test(k)) return "⚠" // warning — penalty
  if (/investigat/.test(k)) return "◎" // bullseye — under investigation
  if (/safety|sc|vsc|red|flag/.test(k)) return "⚑" // flag — SC / flag
  if (/track_limit|leaving|forcing/.test(k)) return "↯" // zigzag — track limits / off
  return "●" // dot — generic
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || name
}

export function TimelineChart({ chart, className }: TimelineChartProps) {
  const events = chart.events
  if (!events || events.length === 0) return null

  // Circuit: prefer the chart-level value (detector), else the first event's.
  const circuit =
    chart.circuit ?? events.find((e) => e.circuit)?.circuit ?? undefined

  // Lap ruler domain. Guard against a single-lap / zero span.
  const laps = events.map((e) => e.lap).filter((n) => Number.isFinite(n))
  const minLap = laps.length ? Math.min(...laps) : 0
  const maxLap = laps.length ? Math.max(...laps) : 1
  const span = Math.max(1, maxLap - minLap)
  const pct = (lap: number) => ((lap - minLap) / span) * 100

  // Group events into per-driver lanes, preserving first-seen order.
  const laneOrder: string[] = []
  const lanes = new Map<string, TimelineEvent[]>()
  for (const e of events) {
    const key = e.driver || "Race control"
    if (!lanes.has(key)) {
      lanes.set(key, [])
      laneOrder.push(key)
    }
    lanes.get(key)!.push(e)
  }

  // Any event with a resolvable corner drives the on-track pin (first wins).
  const cornerEvent = events.find((e) => e.corner_number != null || e.corner_label)

  return (
    <div className={cn("w-full space-y-4", className)}>
      {/* Lap ruler header */}
      <div className="pl-24 md:pl-28">
        <div className="relative h-4">
          <div className="absolute inset-x-0 top-1/2 h-px bg-chart-axis/60" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const lap = Math.round(minLap + t * span)
            return (
              <span
                key={t}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                style={{ left: `${t * 100}%` }}
              >
                L{lap}
              </span>
            )
          })}
        </div>
      </div>

      {/* Per-driver lanes */}
      <div className="space-y-2">
        {laneOrder.map((driver) => {
          const laneEvents = lanes.get(driver)!
          const color = laneEvents[0]?.team_color || "hsl(var(--primary))"
          return (
            <div key={driver} className="flex items-center gap-3">
              {/* Lane label */}
              <div
                className="w-20 md:w-24 shrink-0 text-right text-xs font-semibold truncate"
                style={{ color }}
                title={driver}
              >
                {lastName(driver)}
              </div>
              {/* Lane track */}
              <div className="relative flex-1 h-9 rounded-md bg-secondary/30 border border-border/40">
                <div className="absolute inset-x-2 top-1/2 h-px bg-border/50" />
                {laneEvents.map((e, i) => (
                  <div
                    key={i}
                    className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `calc(${pct(e.lap)}% )` }}
                  >
                    <div
                      className="flex items-center justify-center size-6 rounded-full text-[11px] font-bold text-white shadow-sm ring-2 ring-background"
                      style={{ backgroundColor: e.team_color }}
                      aria-label={`${kindLabels[e.kind] || e.kind} lap ${e.lap}`}
                    >
                      {kindGlyph(e.kind)}
                    </div>
                    {/* Hover detail */}
                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover:block z-10 w-max max-w-[220px] rounded-md bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md border border-border">
                      <span className="font-semibold">Lap {e.lap}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="text-red-text uppercase tracking-wide">
                        {kindLabels[e.kind] || e.kind}
                      </span>
                      {e.corner_label ? (
                        <span className="ml-1 text-muted-foreground">@ {e.corner_label}</span>
                      ) : null}
                      {e.message ? (
                        <p className="mt-0.5 text-muted-foreground leading-snug">{e.message}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Data-gated on-track corner pin */}
      {circuit && cornerEvent && (
        <EventCornerPin
          circuit={circuit}
          cornerNumber={cornerEvent.corner_number}
          cornerLabel={cornerEvent.corner_label}
          color={cornerEvent.team_color || "hsl(var(--primary))"}
          driver={cornerEvent.driver}
          lap={cornerEvent.lap}
        />
      )}
    </div>
  )
}

/** A4 — pin the incident's corner on the real circuit outline. Same resolution
 *  pattern as CornerMiniMap: the corner's lap-fraction is resolved from the
 *  runtime track-outline's corners array. Renders nothing if the outline or
 *  the corner can't be resolved (honest — never a fabricated location). */
function EventCornerPin({
  circuit,
  cornerNumber,
  cornerLabel,
  color,
  driver,
  lap
}: {
  circuit: string
  cornerNumber?: number
  cornerLabel?: string
  color: string
  driver: string
  lap: number
}) {
  const outline = useTrackOutline(circuit || undefined)
  if (!outline || !outline.points?.length || !outline.corners?.length) return null

  const numOf = (label: string) => Number(label.match(/\d+/)?.[0])
  const match =
    (cornerNumber != null && outline.corners.find((c) => numOf(c.label) === cornerNumber)) ||
    (cornerLabel && outline.corners.find((c) => c.label.toLowerCase() === cornerLabel.toLowerCase())) ||
    null
  if (!match) return null

  const shortLabel = cornerNumber != null ? `T${cornerNumber}` : match.label

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-raised p-3">
      <div className="w-24 shrink-0">
        <TrackMap
          outline={outline}
          variant="mini"
          highlights={[{ f0: Math.max(0, match.f - 0.02), f1: Math.min(1, match.f + 0.02), color, label: "" }]}
          markers={[{ f: match.f, color, label: "", r: 30 }]}
        />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] text-section-label uppercase tracking-[0.16em]">Incident · on track</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {lastName(driver)} — {match.label}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          Lap {lap} · {shortLabel} · real {outline.circuit} outline
        </p>
      </div>
    </div>
  )
}
