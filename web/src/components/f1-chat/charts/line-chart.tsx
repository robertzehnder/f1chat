"use client"

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, ReferenceDot } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { ChartTooltip } from "./chart-tooltip"
import { formatChartValue } from "@/lib/f1-formatters"

interface LineChartProps {
  chart: ChartSpec
  className?: string
}

export function LineChart({ chart, className }: LineChartProps) {
  if (!chart.series) return null

  // Find the maximum number of data points
  const maxLength = Math.max(...chart.series.map(s => s.values.length))

  // Transform data for Recharts. NaN values are emitted by the detector
  // when a row is missing for that (lap, driver) pair — passing them as
  // `null` here makes recharts break the line cleanly instead of plunging
  // to 0 and destroying the Y-axis scale.
  const data = Array.from({ length: maxLength }, (_, index) => {
    const point: Record<string, number | null> = { lap: index + 1 }
    chart.series?.forEach((series) => {
      const v = series.values[index]
      point[series.name] = Number.isFinite(v) ? v : null
    })
    return point
  })

  // Fastest-lap markers: only meaningful for absolute lap-time charts, where
  // the minimum value is the fastest lap. For delta/gap charts (decimal_seconds)
  // or plain numeric charts a "minimum" carries no fastest-lap meaning, so we
  // skip it entirely. Component-computed from the series values (no detector /
  // SQL plumbing): for each series find the index of its lowest finite value.
  const fastestLapMarkers =
    chart.y_value_format === "lap_time_s"
      ? chart.series
          .map((series) => {
            let bestIdx = -1
            let bestVal = Infinity
            series.values.forEach((v, i) => {
              if (Number.isFinite(v) && v < bestVal) {
                bestVal = v
                bestIdx = i
              }
            })
            if (bestIdx < 0) return null
            return { name: series.name, color: series.color, lap: bestIdx + 1, value: bestVal }
          })
          .filter((m): m is { name: string; color: string; lap: number; value: number } => m !== null)
      : []

  // Calculate domain for Y axis from finite values only.
  const finiteValues = chart.series.flatMap(s => s.values).filter((v) => Number.isFinite(v))
  const minVal = finiteValues.length ? Math.min(...finiteValues) : 0
  const maxVal = finiteValues.length ? Math.max(...finiteValues) : 1
  const padding = Math.max((maxVal - minVal) * 0.1, 0.1)
  const fmt = chart.y_value_format
  const tickFmt = (v: number) => formatChartValue(v, fmt) || v.toFixed(1)

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={data} margin={{ top: 10, right: 10, left: fmt === "lap_time_s" ? 4 : -10, bottom: 0 }}>
            <XAxis 
              dataKey="lap"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
              interval={Math.floor(maxLength / 6)}
              label={chart.x_label ? { 
                value: chart.x_label, 
                position: "bottom", 
                offset: -5,
                style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } 
              } : undefined}
            />
            <YAxis 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={[minVal - padding, maxVal + padding]}
              tickFormatter={tickFmt}
              width={fmt === "lap_time_s" ? 72 : 40}
            />
            <Tooltip
              content={<ChartTooltip
                labelFormatter={(label) => `Lap ${label}`}
                formatter={(v) => tickFmt(v)}
              />}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
            />
            {chart.series?.map((series) => (
              <Line
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={series.color}
                strokeWidth={series.strokeWidth ?? 2}
                strokeDasharray={series.strokeDasharray}
                strokeOpacity={series.opacity ?? 1}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
            
            {/* Vertical reference lines (e.g., cliff onset, pit stops) */}
            {chart.vertical_markers?.map((marker, idx) => (
              <ReferenceLine
                key={idx}
                x={marker.x}
                stroke="hsl(var(--primary))"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: marker.label,
                  position: "top",
                  fill: "hsl(var(--red-text))",
                  fontSize: 10,
                  fontWeight: 500
                }}
              />
            ))}

            {/* Fastest-lap markers: one diamond per series at its quickest lap. */}
            {fastestLapMarkers.map((m) => (
              <ReferenceDot
                key={`fl-${m.name}`}
                x={m.lap}
                y={m.value}
                r={5}
                shape={(props: { cx?: number; cy?: number }) => {
                  const { cx, cy } = props
                  if (cx == null || cy == null) return <g />
                  const s = 5
                  return (
                    <path
                      d={`M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`}
                      fill={m.color}
                      stroke="hsl(var(--surface-raised))"
                      strokeWidth={1.5}
                    />
                  )
                }}
                isFront
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-3">
        {chart.series?.map((series) => (
          <div key={series.name} className="flex items-center gap-2 text-xs">
            <div 
              className="w-4 h-0.5 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="text-muted-foreground">{series.name}</span>
          </div>
        ))}
      </div>
      {chart.y_label && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">{chart.y_label}</p>
      )}
    </div>
  )
}
