"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { TrackMap, useTrackOutline } from "./track-map"

/**
 * Single-driver speed / traction map: the track ribbon colored from the
 * reference lap's telemetry (speed heat ramp, or throttle/brake zones),
 * with DRS activation zones banded. The outline + channels come from the
 * track-outline API pinned to the exact session/driver the card analyzed.
 */
export function TrackSpeedMap({ chart }: { chart: ChartSpec }) {
  const cfg = chart.speed_map
  const outline = useTrackOutline(chart.circuit, {
    sessionKey: cfg?.sessionKey,
    driver: cfg?.driverNumber,
    channels: true
  })

  if (!cfg) return null
  if (outline === undefined) {
    return <p className="text-xs text-muted-foreground text-center py-8">Deriving track map…</p>
  }
  if (outline === null) {
    return <p className="text-xs text-muted-foreground text-center py-8">No location telemetry available for this circuit.</p>
  }

  const speeds = outline.points.map((p) => p.speed).filter((v): v is number => Number.isFinite(v ?? NaN))
  const minSpeed = speeds.length ? Math.min(...speeds) : null
  const maxSpeed = speeds.length ? Math.max(...speeds) : null

  return (
    <div className="space-y-3">
      <TrackMap outline={outline} gradient={{ channel: cfg.channel }} showDrs />
      <div className="flex justify-center items-center gap-5 text-xs text-muted-foreground">
        {cfg.channel === "throttle_brake" ? (
          <>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[#22C55E]" /> Full throttle</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[#EF4444]" /> Braking</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[#9CA3AF]" /> Coasting / partial</span>
          </>
        ) : (
          <>
            <span>{minSpeed !== null ? `${minSpeed} km/h` : "slow"}</span>
            <span
              className="h-2 w-40 rounded-full"
              style={{ background: "linear-gradient(to right, hsl(240,85%,55%), hsl(120,85%,55%), hsl(0,85%,55%))" }}
            />
            <span>{maxSpeed !== null ? `${maxSpeed} km/h` : "fast"}</span>
          </>
        )}
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[rgba(34,197,94,0.5)]" /> DRS zone</span>
      </div>
    </div>
  )
}
