"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, Legend } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { ChartTooltip } from "./chart-tooltip"

interface GroupedBarChartProps {
  chart: ChartSpec
  className?: string
}

export function GroupedBarChart({ chart, className }: GroupedBarChartProps) {
  if (!chart.x_axis || !chart.series) return null

  // Transform data for Recharts
  const data = chart.x_axis.map((label, index) => {
    const point: Record<string, string | number> = { corner: label }
    chart.series?.forEach((series) => {
      point[series.name] = series.values[index]
    })
    return point
  })

  // Calculate appropriate Y-axis domain based on data range
  const allValues = chart.series.flatMap(s => s.values)
  const minVal = Math.min(...allValues)
  const maxVal = Math.max(...allValues)
  const range = maxVal - minVal
  
  // For small values (like deltas), use auto domain so tiny spreads read.
  // For large values (absolute speeds) baseline at 0 rather than
  // `minVal - padding`: a suppressed origin turns a 3 km/h gap between
  // 280-283 km/h bars into a full-height difference, misreading the data.
  // (Dedicated deltas now route to corner_delta_grid / diverging bars.)
  const isSmallRange = range < 10
  const domainMin = isSmallRange ? 'auto' : 0
  const domainMax = isSmallRange ? 'auto' : maxVal + range * 0.1

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <XAxis 
              dataKey="corner" 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={[domainMin, domainMax]}
              // Round large-range ticks (speeds) to whole numbers — Recharts'
              // auto-domain otherwise emits ugly fractional ticks (e.g. 267.7).
              tickFormatter={(v) => isSmallRange ? Number(v).toFixed(2) : `${Math.round(Number(v))}`}
              allowDecimals={!isSmallRange ? false : true}
            />
            <Tooltip 
              content={<ChartTooltip formatter={(v) => `${v.toFixed(1)} ${chart.y_label || 'km/h'}`} />}
              cursor={{ fill: 'hsl(var(--muted)/0.1)' }}
            />
            {chart.series?.map((series) => (
              <Bar 
                key={series.name}
                dataKey={series.name}
                fill={series.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-3">
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
      {chart.y_label && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">{chart.y_label}</p>
      )}
    </div>
  )
}
