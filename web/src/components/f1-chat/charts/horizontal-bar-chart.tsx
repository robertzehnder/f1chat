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

  // Calculate domain
  const minVal = Math.min(...series.values)
  const maxVal = Math.max(...series.values)

  return (
    <div className={cn("w-full", className)}>
      <div className="h-[280px]">
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
              domain={[Math.floor(minVal * 0.95), Math.ceil(maxVal * 1.02)]}
              tickFormatter={(v) => Number.isInteger(v) ? v.toString() : v.toFixed(1)}
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
              content={<SimpleTooltip valueLabel={chart.x_label} valueFormatter={(v) => v.toFixed(1)} />}
              cursor={{ fill: 'hsl(var(--muted)/0.1)' }}
            />
            <Bar 
              dataKey="value" 
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
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
