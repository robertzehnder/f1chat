"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { DivergingBarChart } from "./diverging-bar-chart"
import { TrackMap, useTrackOutline } from "./track-map"

/**
 * Brake-zone / corner comparison card: neutral track ribbon with the
 * analyzed corner windows highlighted in the faster driver's color
 * (positions from analytics.corner_analysis normalized fractions), plus
 * the signed delta bars as the numeric detail. Falls back to bars-only
 * when the circuit has no derived outline.
 */
export function TrackCornerDelta({ chart }: { chart: ChartSpec }) {
  const outline = useTrackOutline(chart.circuit)
  const zones = chart.corner_zones ?? []

  return (
    <div className="space-y-4">
      {outline && zones.length > 0 && (
        <TrackMap
          outline={outline}
          highlights={zones.map((z) => ({
            f0: z.f0,
            f1: z.f1,
            color: z.color,
            label: z.label
          }))}
        />
      )}
      {outline && zones.length > 0 && (
        <div className="flex justify-center gap-6">
          {[...new Map(zones.map((z) => [z.leader, z.color])).entries()].map(([leader, color]) => (
            <div key={leader} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-xs text-muted-foreground">{leader} faster zones</span>
            </div>
          ))}
        </div>
      )}
      <DivergingBarChart chart={chart} />
    </div>
  )
}
