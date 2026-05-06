"use client"

import { Radar, RadarChart as RechartsRadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { ChartTooltip } from "./chart-tooltip"

interface RadarChartProps {
  chart: ChartSpec
  className?: string
}

export function RadarChart({ chart, className }: RadarChartProps) {
  if (!chart.axes || !chart.series) return null

  // Transform data for Recharts
  const data = chart.axes.map((axis, index) => {
    const point: Record<string, string | number> = { axis }
    chart.series?.forEach((series) => {
      point[series.name] = series.values[index]
    })
    return point
  })

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
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
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
    </div>
  )
}
