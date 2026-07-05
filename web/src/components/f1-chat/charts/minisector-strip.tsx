"use client"

import { TrackMap, useTrackOutline } from "./track-map"

interface MinisectorStripProps {
  chart: {
    type: "track_heatmap"
    circuit?: string
    sector?: number
    delta_unit?: string
    dominance_legend?: Array<{ name: string; color: string; count: number }>
    segments: Array<{
      minisector_index: number
      name: string
      leader: string
      color: string
      delta_ms: number
    }>
  }
}

/**
 * Sector / minisector dominance card: F1-TV-style track dominance map
 * (segments colored by the faster driver, boundaries at the REAL timing
 * lines for the 3 official sectors) + the per-segment numeric strip.
 * Falls back to strip-only when no outline exists for the circuit.
 */
export function MinisectorStrip({ chart }: MinisectorStripProps) {
  const { circuit, sector, segments, delta_unit } = chart
  const unit = delta_unit ?? "ms"
  const outline = useTrackOutline(circuit)

  // Bar scaling: normalize against the largest delta so any unit
  // (ms / km/h / s) fills the bar sensibly. No 1-unit floor — sector
  // deltas are fractions of a second and a floor flattens every bar.
  const maxDelta = Math.max(0.001, ...segments.map((s) => Math.abs(s.delta_ms || 0)))
  const segmentNoun = segments[0]?.name?.toLowerCase().startsWith("sector") ? "sectors" : "minisectors"

  const ordered = [...segments].sort((a, b) => a.minisector_index - b.minisector_index)
  const isOfficialSectors = ordered.length === 3 && outline?.sectors?.length === 2
  const boundaries = isOfficialSectors
    ? [0, outline!.sectors[0], outline!.sectors[1], 1]
    : undefined

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground">
          {circuit} {sector ? `Sector ${sector}` : ""} — {segments.length} {segmentNoun}
        </p>
      </div>

      {/* Track dominance map (derived outline); strip remains below as the
          per-segment numeric detail */}
      {outline && (
        <TrackMap
          outline={outline}
          segments={ordered.map((s) => ({ color: s.color, label: `${s.name} — ${s.leader}` }))}
          segmentBoundaries={boundaries}
        />
      )}

      {/* Leader summary / legend. Prefer the explicit both-drivers legend so the
          driver who won zero segments still appears; fall back to deriving from
          segment leaders when it isn't provided. */}
      <div className="flex justify-center gap-6 pt-2 border-t border-border/50">
        {(chart.dominance_legend ??
          Object.entries(
            segments.reduce((acc, seg) => {
              acc[seg.leader] = (acc[seg.leader] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([name, count]) => ({
            name,
            count,
            color: segments.find((s) => s.leader === name)?.color ?? "#888888",
          }))
        ).map(({ name: leader, count, color }) => {
          return (
            <div key={leader} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-xs text-muted-foreground">
                {leader}: {count}
              </span>
            </div>
          )
        })}
      </div>

      {/* Vertical strip visualization */}
      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-xs text-muted-foreground w-28 truncate">{seg.name}</span>
            <div className="flex-1 h-2 bg-secondary/30 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: seg.color,
                  width: `${Math.min(100, (Math.abs(seg.delta_ms) / maxDelta) * 100)}%`
                }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-16 text-right">
              +{seg.delta_ms}
              {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
