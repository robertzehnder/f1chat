"use client"

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { ChartTooltip } from "./chart-tooltip"

interface LineChartProps {
  chart: ChartSpec
  className?: string
}

export function LineChart({ chart, className }: LineChartProps) {
  if (!chart.series) return null

  // Find the maximum number of data points
  const maxLength = Math.max(...chart.series.map(s => s.values.length))
  
  // Transform data for Recharts
  const data = Array.from({ length: maxLength }, (_, index) => {
    const point: Record<string, number> = { lap: index + 1 }
    chart.series?.forEach((series) => {
      if (series.values[index] !== undefined) {
        point[series.name] = series.values[index]
      }
    })
    return point
  })

  // Calculate domain for Y axis
  const allValues = chart.series.flatMap(s => s.values)
  const minVal = Math.min(...allValues)
  const maxVal = Math.max(...allValues)
  const padding = (maxVal - minVal) * 0.1

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip 
              content={<ChartTooltip 
                labelFormatter={(label) => `Lap ${label}`}
                formatter={(v) => `${v.toFixed(2)}s`}
              />}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
            />
            {chart.series?.map((series) => (
              <Line 
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
            
            {/* Vertical reference lines (e.g., cliff onset, pit stops) */}
            {chart.vertical_markers?.map((marker, idx) => (
              <ReferenceLine
                key={idx}
                x={marker.x}
                stroke="#E10600"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: marker.label,
                  position: "top",
                  fill: "#E10600",
                  fontSize: 10,
                  fontWeight: 500
                }}
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
