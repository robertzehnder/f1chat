"use client"

import { Radar, RadarChart as RechartsRadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { ChartTooltip } from "./chart-tooltip"

interface RadarChartProps {
  chart: ChartSpec
  className?: string
}

// Custom tick renderer for PolarAngleAxis: greys + dashes the spoke label
// for any axis in `empty_axes` (B3 — retained-but-unpopulated axes). Recharts
// passes { payload: { value } } where value is the axis label.
function makeAngleTick(emptyAxes: Set<string>) {
  return function AngleTick(props: {
    x?: number
    y?: number
    textAnchor?: "start" | "middle" | "end" | "inherit"
    payload?: { value?: string | number }
  }) {
    const { x = 0, y = 0, textAnchor, payload } = props
    const label = String(payload?.value ?? "")
    const isEmpty = emptyAxes.has(label)
    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        fontSize={11}
        fill={isEmpty ? "hsl(var(--muted-foreground))" : "hsl(var(--muted-foreground))"}
        fillOpacity={isEmpty ? 0.45 : 1}
        fontStyle={isEmpty ? "italic" : "normal"}
      >
        {label}
        {isEmpty ? " · n/a" : ""}
      </text>
    )
  }
}

export function RadarChart({ chart, className }: RadarChartProps) {
  if (!chart.axes || !chart.series) return null

  const emptyAxes = new Set(chart.empty_axes ?? [])

  // Transform data for Recharts. F13 final guard: clamp any value into the
  // [0,100] domain so a stray off-scale number (e.g. a year that slipped
  // the detector's axis filter) can't blow out the polygon.
  const maxValue = typeof chart.max_value === "number" && chart.max_value > 0 ? chart.max_value : 100
  const data = chart.axes.map((axis, index) => {
    const point: Record<string, string | number> = { axis }
    chart.series?.forEach((series) => {
      const raw = series.values[index]
      point[series.name] = typeof raw === "number" && Number.isFinite(raw)
        ? Math.max(0, Math.min(maxValue, raw))
        : 0
    })
    return point
  })

  const AngleTick = makeAngleTick(emptyAxes)

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsRadarChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
            <PolarGrid
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <PolarAngleAxis
              dataKey="axis"
              tick={<AngleTick />}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              tickCount={5}
            />
            <Tooltip
              content={<ChartTooltip formatter={(v) => `${v}`} />}
            />
            {chart.series?.map((series) => (
              <Radar
                key={series.name}
                name={series.name}
                dataKey={series.name}
                stroke={series.color}
                fill={series.color}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </RechartsRadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-2">
        {chart.series?.map((series) => (
          <div key={series.name} className="flex items-center gap-2 text-xs">
            <div
              className="size-3 rounded-sm"
              style={{ backgroundColor: series.color }}
            />
            <span className="text-muted-foreground">{series.name}</span>
          </div>
        ))}
      </div>
      {chart.empty_axes && chart.empty_axes.length > 0 ? (
        <div className="mt-2 flex flex-col items-center gap-1">
          <p className="font-mono text-[10px] text-semantic-warning/90 text-center tracking-wide">
            ⚠ {chart.empty_axes.length} of {chart.total_axes ?? chart.axes?.length ?? "?"} axes insufficient to rank
          </p>
          <p className="font-mono text-[10px] text-muted-foreground/70 text-center tracking-wide">
            greyed (n/a): {chart.empty_axes.join(" · ")}
          </p>
        </div>
      ) : chart.partial_data_axes && chart.partial_data_axes > 0 ? (
        <p className="font-mono text-[10px] text-semantic-warning/90 text-center mt-2 tracking-wide">
          ⚠ {chart.partial_data_axes} of {chart.total_axes ?? chart.axes?.length ?? "?"} axes low-sample · insufficient to rank
        </p>
      ) : null}
    </div>
  )
}
