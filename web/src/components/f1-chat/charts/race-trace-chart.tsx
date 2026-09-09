"use client"

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { ChartNote } from "./line-hardening"
import { LANE_TOP, RacingStateLegend, mergeChartNotes, racingStateNotes, renderAnnotations, renderRacingStateLayer } from "./racing-state-layer"

/**
 * Race trace: every driver's gap to the leader, lap by lap. Y axis is
 * reversed (leader at the top), SC/VSC windows are shaded bands, pit
 * stops are dots on each trace.
 */
export function RaceTraceChart({ chart }: { chart: ChartSpec }) {
  const { horizontal_marker } = chart
  const series = chart.series ?? []
  if (series.length === 0) return null
  const maxLen = Math.max(...series.map((s) => s.values.length))
  const lapAt = (i: number): number => chart.lap_numbers?.[i] ?? i + 1
  const firstLap = lapAt(0)
  const lastLap = lapAt(maxLen - 1)
  const data = Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number> = { lap: lapAt(i) }
    series.forEach((s) => {
      const v = s.values[i]
      if (Number.isFinite(v)) point[s.name] = v
    })
    return point
  })

  // Racing-state layer (record) replaces the lap-time heuristic when the
  // race-control feed is available; the heuristic survives ONLY as a
  // labelled "slow laps" overlay when the feed is absent/failed.
  const rs = chart.racing_state
  const recordAvailable = rs?.source === "available" || rs?.source === "incomplete"
  const heuristicLabel = rs ? "slow laps (heuristic)" : "SC/VSC"
  const bands: Array<[number, number]> = []
  for (const lap of recordAvailable ? [] : chart.neutralized_laps ?? []) {
    const last = bands[bands.length - 1]
    if (last && lap === last[1] + 1) last[1] = lap
    else bands.push([lap, lap])
  }

  const finite = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v))
  const maxGap = finite.length ? Math.max(...finite) : 1
  // Gap axis ends at the data; the domain is padded past it only to make room
  // for the sector-alert lane, and no tick or gridline is drawn in that lane.
  const gapTop = Math.ceil(maxGap / 10) * 10
  const explicit = chart.y_domain
  const yBottom = explicit ? explicit[0] : 0
  const yTop = explicit ? explicit[1] : gapTop
  const yDomainTop = recordAvailable ? yTop + (yTop - yBottom) * 0.1 : yTop
  const step = yTop - yBottom > 30 ? 10 : yTop - yBottom > 12 ? 5 : yTop - yBottom > 4 ? 2 : 1
  const yTicks: number[] = []
  for (let v = Math.ceil(yBottom / step) * step; v <= yTop + 1e-9; v += step) yTicks.push(+v.toFixed(3))

  // Story emphasis: honor detector-set `emphasis`; else derive the two lines
  // worth following — the winner (ends nearest the leader) and the biggest
  // climber (largest gap reduction) — and dim the rest of the field so the
  // full-field trace reads as a story instead of spaghetti.
  const lastGap = (s: (typeof series)[number]) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (Number.isFinite(s.values[i])) return s.values[i]
    return Infinity
  }
  const firstGap = (s: (typeof series)[number]) => {
    for (let i = 0; i < s.values.length; i++) if (Number.isFinite(s.values[i])) return s.values[i]
    return 0
  }
  let emphasized: Set<string>
  if (series.some((s) => s.emphasis === true)) {
    emphasized = new Set(series.filter((s) => s.emphasis === true).map((s) => s.name))
  } else if (series.length > 3) {
    const winner = [...series].sort((a, b) => lastGap(a) - lastGap(b))[0]
    const mover = [...series].sort((a, b) => firstGap(b) - lastGap(b) - (firstGap(a) - lastGap(a)))[0]
    emphasized = new Set([winner?.name, mover?.name].filter(Boolean) as string[])
  } else {
    emphasized = new Set() // small field: no dimming
  }
  const dimPack = emphasized.size > 0 && emphasized.size < series.length

  return (
    <div className="space-y-2">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={data} margin={{ top: recordAvailable ? LANE_TOP : 10, right: 12, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="lap"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              label={{ value: chart.x_label ?? "Lap", position: "bottom", offset: 0, fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            />
            <YAxis
              reversed
              domain={[yBottom, yDomainTop]}
              ticks={yTicks}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={44}
              label={{ value: chart.y_label ?? "Gap (s)", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
              labelFormatter={(label) => `Lap ${label}`}
              formatter={(v: number, name: string) => [`${v >= 0 ? "+" : ""}${v.toFixed(explicit ? 3 : 1)}s`, name]}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              itemStyle={{ color: "hsl(var(--muted-foreground))" }}
            />
            {horizontal_marker && (
              <ReferenceLine
                y={horizontal_marker.value}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                label={{
                  value: horizontal_marker.label,
                  position: "insideBottomRight",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 9
                }}
              />
            )}
            {renderRacingStateLayer(recordAvailable ? rs : undefined, lastLap, firstLap)}
            {renderAnnotations(chart.annotations, lastLap, firstLap)}
            {bands.map(([a, b], i) => (
              <ReferenceArea key={`sc-${i}`} x1={a - 0.5} x2={b + 0.5} fill="hsl(var(--semantic-warning))" fillOpacity={0.12} strokeOpacity={0} />
            ))}
            {series.map((s) => {
              const emph = emphasized.has(s.name)
              return (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={s.color}
                  strokeWidth={emph ? 2.6 : 1.5}
                  strokeOpacity={dimPack && !emph ? 0.28 : 1}
                  dot={false}
                  // Recharts reveals lines with a JavaScript animation. PNG
                  // capture can otherwise freeze a partially drawn trace;
                  // Playwright's animations: "disabled" only handles CSS/Web
                  // Animations, not this reveal. Render the full curve at once.
                  isAnimationActive={false}
                  connectNulls
                />
              )
            })}
            {(chart.trace_pit_dots ?? []).map((d, i) => (
              <ReferenceDot
                key={`pit-${i}`}
                x={d.x}
                y={d.y}
                r={3.5}
                fill={d.color}
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                label={d.label ? { value: d.label, position: "right", fill: d.color, fontSize: 9, offset: 6 } : undefined}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      <ChartNote note={mergeChartNotes(chart.chart_note, racingStateNotes(rs))} />
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
        <RacingStateLegend state={recordAvailable ? rs : undefined} />
        {bands.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-sm bg-semantic-warning opacity-40" /> {heuristicLabel}
          </span>
        )}
        {(chart.trace_pit_dots ?? []).length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-full border border-border bg-muted-foreground" /> pit stop
          </span>
        )}
      </div>
    </div>
  )
}
