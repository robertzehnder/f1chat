"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, ReferenceLine } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { getTeamColorByDriver } from "@/lib/f1-team-colors"
import { SimpleTooltip } from "./chart-tooltip"

interface DivergingBarChartProps {
  chart: ChartSpec
  className?: string
}

export function DivergingBarChart({ chart, className }: DivergingBarChartProps) {
  if (!chart.y_axis || !chart.series?.[0]) return null

  const series = chart.series[0]
  // Unit + legend semantics come from the spec — this renderer also serves
  // non-position deltas (brake-zone apex-speed in km/h). Defaults keep the
  // original lap-1 positions behavior.
  const unit = chart.y_value_format === "kph" ? "km/h" : "positions"
  const positiveLabel = chart.legend?.positive ?? "Positions gained"
  const negativeLabel = chart.legend?.negative ?? "Positions lost"
  const positiveColor = chart.diverging_colors?.positive ?? "hsl(var(--semantic-positive))"
  const negativeColor = chart.diverging_colors?.negative ?? "hsl(var(--semantic-negative))"

  // Transform data for Recharts
  const data = chart.y_axis.map((label, index) => ({
    name: label,
    value: series.values[index],
    color: getTeamColorByDriver(label),
    isPositive: series.values[index] >= 0
  }))

  // Calculate domain
  const allValues = series.values
  const maxAbs = Math.max(...allValues.map(Math.abs))
  // Winner emphasis: the biggest mover (largest |Δ|) reads at full strength.
  const winnerIdx = allValues.map(Math.abs).indexOf(maxAbs)

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart 
            data={data} 
            layout="vertical"
            margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
          >
            <XAxis 
              type="number"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
              domain={[-maxAbs - 1, maxAbs + 1]}
            />
            <YAxis 
              type="category"
              dataKey="name"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={80}
            />
            <Tooltip
              content={<SimpleTooltip valueFormatter={(v) => `${v > 0 ? '+' : ''}${v} ${unit}`} />}
              cursor={{ fill: 'hsl(var(--muted)/0.1)' }}
            />
            <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1} />
            <Bar 
              dataKey="value" 
              maxBarSize={20}
            >
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isPositive ? positiveColor : negativeColor}
                  fillOpacity={index === winnerIdx ? 1 : 0.5}
                  // recharts type for `radius` on Cell is too narrow — the
                  // 4-tuple form is supported at runtime; cast through unknown.
                  radius={(entry.isPositive ? [0, 4, 4, 0] : [4, 0, 0, 4]) as unknown as number}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-2 text-xs">
          <div className="size-3 rounded-sm" style={{ backgroundColor: positiveColor }} />
          <span className="text-muted-foreground">{positiveLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="size-3 rounded-sm" style={{ backgroundColor: negativeColor }} />
          <span className="text-muted-foreground">{negativeLabel}</span>
        </div>
      </div>
      {chart.x_label && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">{chart.x_label}</p>
      )}
    </div>
  )
}
