"use client"

import { ScatterChart as RechartsScatterChart, Scatter, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, ZAxis } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"
import { SimpleTooltip } from "./chart-tooltip"

interface ScatterChartProps {
  chart: ChartSpec
  className?: string
}

export function ScatterChart({ chart, className }: ScatterChartProps) {
  if (!chart.series) return null

  // Calculate Y domain from all points
  const allYValues = chart.series.flatMap(s => s.points?.map(p => p[1]) || [])
  const minY = Math.min(...allYValues)
  const maxY = Math.max(...allYValues)
  const yPadding = (maxY - minY) * 0.1

  // Calculate X domain from all points
  const allXValues = chart.series.flatMap(s => s.points?.map(p => p[0]) || [])
  const maxX = Math.max(...allXValues)

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <XAxis 
              type="number"
              dataKey="x"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
              domain={[0, maxX + 1]}
              label={{ 
                value: chart.x_label || "Stint lap", 
                position: "bottom", 
                offset: -5,
                style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } 
              }}
            />
            <YAxis 
              type="number"
              dataKey="y"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={[minY - yPadding, maxY + yPadding]}
              tickFormatter={(v) => v.toFixed(1)}
              label={{ 
                value: chart.y_label || "Lap time (s)", 
                angle: -90, 
                position: "insideLeft",
                offset: 15,
                style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } 
              }}
            />
            <ZAxis range={[30, 30]} />
            <Tooltip 
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const data = payload[0]?.payload
                return (
                  <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                    <p className="text-sm font-semibold text-foreground">{data?.driver}</p>
                    <p className="text-xs text-muted-foreground">
                      Lap {data?.x}: <span className="text-foreground font-medium">{data?.y?.toFixed(2)}s</span>
                    </p>
                  </div>
                )
              }}
              cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--muted-foreground))' }}
            />
            {chart.series?.map((series) => {
              const data = series.points?.map(([x, y]) => ({ 
                x, 
                y, 
                driver: series.name 
              })) || []
              
              return (
                <Scatter
                  key={series.name}
                  name={series.name}
                  data={data}
                  fill={series.color}
                  line={{ stroke: series.color, strokeWidth: 2, strokeOpacity: 0.6 }}
                  lineType="fitting"
                />
              )
            })}
          </RechartsScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-3">
        {chart.series?.map((series) => (
          <div key={series.name} className="flex items-center gap-2 text-xs">
            <div 
              className="size-3 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="text-muted-foreground">
              {series.name}
              {series.slope && (
                <span className="text-[10px] ml-1 text-muted-foreground/70">
                  ({series.slope > 0 ? '+' : ''}{series.slope.toFixed(3)} s/lap)
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {chart.y_label && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">{chart.y_label}</p>
      )}
    </div>
  )
}
