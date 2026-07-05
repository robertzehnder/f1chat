"use client"

import { useEffect, useState } from "react"
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { getDistinctTeamStyles } from "@/lib/f1-team-colors"
import { TrackMap, useTrackOutline } from "./track-map"

/**
 * Stacked fastest-lap telemetry: speed / gear / throttle+brake panels,
 * distance-aligned (x = % of lap), with corner ticks. Traces fetched
 * from /api/lap-telemetry pinned to the exact session + drivers.
 */

type Trace = {
  driverNumber: number
  driverName: string | null
  lapNumber: number | null
  lapDuration: number | null
  f: number[]
  speed: Array<number | null>
  throttle: Array<number | null>
  brake: Array<number | null>
  gear: Array<number | null>
}
type Payload = {
  sessionKey: number
  circuit: string | null
  corners: Array<{ label: string; f: number }>
  drivers: Trace[]
}

// Resample every trace onto a shared 0..100% axis (200 steps) so two
// laps of different lengths align by track position.
const STEPS = 200

function resample(trace: Trace, channel: "speed" | "throttle" | "brake" | "gear"): Array<number | null> {
  const out: Array<number | null> = []
  let j = 0
  for (let i = 0; i <= STEPS; i += 1) {
    const f = i / STEPS
    while (j + 1 < trace.f.length && trace.f[j + 1] <= f) j += 1
    out.push(trace[channel][j] ?? null)
  }
  return out
}

function Panel({
  title,
  data,
  lines,
  yLabel,
  height,
  corners
}: {
  title: string
  data: Array<Record<string, number | null>>
  lines: Array<{ key: string; color: string; dashed?: boolean }>
  yLabel: string
  height: number
  corners: Array<{ label: string; f: number }>
}) {
  const cornerTicks = corners.map((c) => Math.round(c.f * 100))
  return (
    <div style={{ height }} className="w-full">
      <p className="text-[10px] text-muted-foreground text-center mb-0.5">{title}</p>
      <ResponsiveContainer width="100%" height="92%">
        <RechartsLineChart data={data} margin={{ top: 2, right: 10, left: 0, bottom: 0 }} syncId="telemetry">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
          <XAxis
            dataKey="pct"
            type="number"
            domain={[0, 100]}
            ticks={cornerTicks.length ? cornerTicks : undefined}
            tickFormatter={(v: number) => {
              const corner = corners.find((c) => Math.round(c.f * 100) === v)
              return corner ? (corner.label.match(/\d+/)?.[0] ? `T${corner.label.match(/\d+/)![0]}` : corner.label) : `${v}%`
            }}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
            width={38}
            label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }}
            labelFormatter={(v) => `${v}% of lap`}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            itemStyle={{ color: "hsl(var(--muted-foreground))" }}
          />
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              stroke={l.color}
              strokeWidth={1.6}
              strokeDasharray={l.dashed ? "5 3" : undefined}
              dot={false}
              connectNulls
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TelemetryOverlayChart({ chart }: { chart: ChartSpec }) {
  const cfg = chart.telemetry_overlay
  const [payload, setPayload] = useState<Payload | null | undefined>(undefined)

  useEffect(() => {
    if (!cfg) {
      setPayload(null)
      return
    }
    let cancelled = false
    fetch(`/api/lap-telemetry?sessionKey=${cfg.sessionKey}&drivers=${cfg.drivers.map((d) => d.number).join(",")}`)
      .then((r) => (r.ok ? (r.json() as Promise<Payload>) : null))
      .then((data) => {
        if (!cancelled) setPayload(data && data.drivers?.length ? data : null)
      })
      .catch(() => {
        if (!cancelled) setPayload(null)
      })
    return () => {
      cancelled = true
    }
  }, [cfg])

  // Outline for the "biggest delta · where" minimap (client-only — reuses the
  // runtime track-outline). Hook must run before the early returns; a null
  // circuit yields null and renders nothing.
  const outline = useTrackOutline(payload?.circuit ?? undefined)

  if (!cfg) return null
  if (payload === undefined) {
    return <p className="text-xs text-muted-foreground text-center py-8">Aligning telemetry…</p>
  }
  if (payload === null) {
    return <p className="text-xs text-muted-foreground text-center py-8">No lap telemetry available for these drivers.</p>
  }

  const names = payload.drivers.map((d) => d.driverName ?? `#${d.driverNumber}`)
  // Same-team drivers get distinct HUES (primary vs secondary team color) so the
  // two traces separate even where they overlap. Dash stays reserved for the
  // pedal panel's throttle/brake distinction — no conflict, since driver identity
  // is carried by color here.
  const styles = getDistinctTeamStyles(names)
  const colorOf = (name: string) => styles[name]?.color ?? "#888888"
  const resampled = payload.drivers.map((d) => ({
    name: d.driverName ?? `#${d.driverNumber}`,
    speed: resample(d, "speed"),
    gear: resample(d, "gear"),
    throttle: resample(d, "throttle"),
    brake: resample(d, "brake")
  }))

  const buildData = (channels: Array<{ key: string; values: Array<number | null> }>) =>
    Array.from({ length: STEPS + 1 }, (_, i) => {
      const point: Record<string, number | null> = { pct: Math.round((i / STEPS) * 100) }
      channels.forEach((c) => {
        point[c.key] = c.values[i]
      })
      return point
    })

  // Biggest speed-Δ location: the track fraction where the two laps differ
  // most, mapped to an outline point for the minimap pin (deck A2).
  let deltaMarker:
    | { f: number; color: string; delta: number; faster: string; corner: string }
    | null = null
  if (resampled.length === 2) {
    const [a, b] = resampled
    // Two DIFFERENT fastest laps compared by track fraction — a single
    // mis-sampled point can spike the raw delta (e.g. one car mid-corner while
    // the other is on a held sample). Smooth each speed over a ±3-step window
    // so the "biggest Δ" reflects a SUSTAINED difference, not a lone artifact.
    const smooth = (arr: Array<number | null>, i: number): number | null => {
      let sum = 0
      let n = 0
      for (let k = Math.max(0, i - 3); k <= Math.min(STEPS, i + 3); k += 1) {
        const v = arr[k]
        if (v != null) {
          sum += v
          n += 1
        }
      }
      return n ? sum / n : null
    }
    let bestI = -1
    let bestD = -1
    for (let i = 0; i <= STEPS; i += 1) {
      const va = smooth(a.speed, i)
      const vb = smooth(b.speed, i)
      if (va == null || vb == null) continue
      const d = Math.abs(va - vb)
      if (d > bestD) {
        bestD = d
        bestI = i
      }
    }
    if (bestI >= 0 && bestD >= 3) {
      const f = bestI / STEPS
      const faster = (a.speed[bestI] as number) >= (b.speed[bestI] as number) ? a : b
      const near = payload.corners.length
        ? payload.corners.reduce((acc, c) => (Math.abs(c.f - f) < Math.abs(acc.f - f) ? c : acc))
        : null
      const cornerNum = near?.label.match(/\d+/)?.[0]
      deltaMarker = {
        f,
        color: colorOf(faster.name),
        delta: Math.round(bestD),
        faster: faster.name,
        corner: near ? (cornerNum ? `Turn ${cornerNum}` : near.label) : `${Math.round(f * 100)}% of lap`
      }
    }
  }

  const speedData = buildData(resampled.map((d) => ({ key: d.name, values: d.speed })))
  const gearData = buildData(resampled.map((d) => ({ key: d.name, values: d.gear })))
  const pedalData = buildData(
    resampled.flatMap((d) => [
      { key: `${d.name} throttle`, values: d.throttle },
      { key: `${d.name} brake`, values: d.brake }
    ])
  )

  return (
    <div className="space-y-1">
      <Panel
        title="Speed (km/h)"
        data={speedData}
        lines={resampled.map((d) => ({ key: d.name, color: colorOf(d.name) }))}
        yLabel="km/h"
        height={190}
        corners={payload.corners}
      />
      <Panel
        title="Gear"
        data={gearData}
        lines={resampled.map((d) => ({ key: d.name, color: colorOf(d.name) }))}
        yLabel="gear"
        height={110}
        corners={payload.corners}
      />
      <Panel
        title="Throttle (solid) / Brake (dashed)"
        data={pedalData}
        lines={resampled.flatMap((d) => [
          { key: `${d.name} throttle`, color: colorOf(d.name) },
          { key: `${d.name} brake`, color: colorOf(d.name), dashed: true }
        ])}
        yLabel="%"
        height={130}
        corners={payload.corners}
      />
      <div className="flex justify-center gap-4 pt-1">
        {resampled.map((d) => (
          <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(d.name) }} />
            {d.name}
          </span>
        ))}
      </div>

      {/* Biggest-Δ minimap — turns "how much faster" into "where faster". */}
      {outline && deltaMarker && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-border/60 bg-surface-raised p-3">
          <div className="w-24 shrink-0">
            <TrackMap outline={outline} variant="mini" markers={[{ f: deltaMarker.f, color: deltaMarker.color, r: 34 }]} />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-section-label uppercase tracking-[0.16em]">Biggest Δ · where</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{deltaMarker.corner}</p>
            <p className="font-mono text-xs" style={{ color: deltaMarker.color }}>
              {deltaMarker.faster.split(" ").slice(-1)[0]} +{deltaMarker.delta} kph
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
