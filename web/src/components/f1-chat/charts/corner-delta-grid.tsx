"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { DivergingBarChart } from "./diverging-bar-chart"
import { TrackMap, useTrackOutline } from "./track-map"

/**
 * All-corner 2-driver entry/apex/exit delta card (A5). Three surfaces:
 *   1. Mini track map with a sized node at every corner (radius scaled by
 *      |apex delta|, colored by the faster driver).
 *   2. Per-corner phase tiles (entry / apex / exit signed km/h deltas).
 *   3. Who-is-faster-where diverging ladder (apex delta per corner, biggest
 *      gap first) via <DivergingBarChart>.
 *
 * Falls back to tiles + ladder when the circuit has no derived outline.
 */
export function CornerDeltaGrid({ chart }: { chart: ChartSpec }) {
  const outline = useTrackOutline(chart.circuit)
  const deltas = chart.corner_deltas ?? []
  const drivers = chart.corner_delta_drivers

  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`

  return (
    <div className="space-y-4">
      {outline && deltas.length > 0 && (
        <TrackMap
          outline={outline}
          markers={deltas.map((d) => ({ f: d.f, color: d.color, r: d.node_r }))}
        />
      )}
      {drivers && (
        <div className="flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: drivers.a_color }} />
            <span className="text-xs text-muted-foreground">{drivers.a} faster</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: drivers.b_color }} />
            <span className="text-xs text-muted-foreground">{drivers.b} faster</span>
          </div>
        </div>
      )}
      {deltas.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {deltas.map((d) => (
            <div
              key={d.label}
              className="rounded-md border border-border bg-[hsl(var(--surface-raised))] px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{d.label}</span>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1 text-center">
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[hsl(var(--section-label))]">Entry</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(d.entry_delta)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[hsl(var(--section-label))]">Apex</div>
                  <div className="text-xs font-semibold tabular-nums text-foreground">{fmt(d.apex_delta)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[hsl(var(--section-label))]">Exit</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(d.exit_delta)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <DivergingBarChart chart={chart} />
    </div>
  )
}
