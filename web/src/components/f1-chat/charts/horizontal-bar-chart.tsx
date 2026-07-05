"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, LabelList } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { getTeamColorByDriver } from "@/lib/f1-team-colors"
import { SimpleTooltip } from "./chart-tooltip"

interface HorizontalBarChartProps {
  chart: ChartSpec
  className?: string
}

export function HorizontalBarChart({ chart, className }: HorizontalBarChartProps) {
  if (!chart.y_axis || !chart.series?.[0]) return null

  const series = chart.series[0]
  
  // Transform data for Recharts
  const data = chart.y_axis.map((label, index) => ({
    name: label,
    value: series.values[index],
    color: getTeamColorByDriver(label)
  }))

  // Calculate domain. Bars encode value as LENGTH, so the baseline must
  // be zero for all-positive data — a floor(min*0.95) baseline renders
  // 23.3s vs 23.6s as a ~2x length difference (2025 Spa pit-duration
  // incident). Tightly-clustered values drawing near-equal bars is the
  // honest picture; the value labels carry the precision. Only data that
  // actually crosses zero keeps a negative floor.
  const minVal = Math.min(...series.values)
  const maxVal = Math.max(...series.values)
  const domainMin = minVal < 0 ? Math.floor(minVal * 1.05) : 0
  // Leader emphasis: the top bar renders at full strength, the rest dim back
  // so the answer ("who's most") reads at a glance instead of a flat ranking.
  const leaderIdx = series.values.indexOf(maxVal)

  // Height + bar size scale with row count so all drivers (typically 20)
  // remain readable without overlapping. ~22px per bar + 40px for axis
  // labels keeps spacing consistent from 5 bars up to 20+.
  const rowCount = data.length
  const rowPx = rowCount <= 12 ? 24 : rowCount <= 18 ? 20 : 18
  const chartHeight = Math.max(280, rowCount * rowPx + 40)
  const barSize = Math.max(10, rowPx - 4)

  return (
    <div className={cn("w-full", className)}>
      <div style={{ height: `${chartHeight}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 50, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
              domain={[domainMin, Math.ceil(maxVal * 1.02)]}
              tickFormatter={(v) => Number.isInteger(v) ? v.toString() : v.toFixed(1)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: rowCount > 18 ? 10 : 11 }}
              axisLine={false}
              tickLine={false}
              width={88}
              interval={0}
            />
            <Tooltip
              content={<SimpleTooltip valueLabel={chart.x_label} valueFormatter={(v) => v.toFixed(1)} />}
              cursor={{ fill: 'hsl(var(--muted)/0.1)' }}
            />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              maxBarSize={barSize}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} fillOpacity={index === leaderIdx ? 1 : 0.45} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v: number) => v.toFixed(1)}
                style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {chart.x_label && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">{chart.x_label}</p>
      )}
    </div>
  )
}
