"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Cell
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"

interface StackedHorizontalBarChartProps {
  chart: ChartSpec
}

export function StackedHorizontalBarChart({ chart }: StackedHorizontalBarChartProps) {
  if (!chart.y_axis || !chart.series) return null

  // Transform data for Recharts
  const data = chart.y_axis.map((driver, i) => {
    const entry: Record<string, string | number> = { driver }
    chart.series?.forEach((s) => {
      entry[s.name] = s.values[i]
    })
    return entry
  })

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 80, bottom: 10 }}
        >
          <XAxis
            type="number"
            stroke="#6b7280"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "#374151" }}
          />
          <YAxis
            type="category"
            dataKey="driver"
            stroke="#6b7280"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={75}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px"
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            itemStyle={{ color: "hsl(var(--muted-foreground))" }}
            cursor={{ fill: 'hsl(var(--muted)/0.1)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }}
          />
          {chart.series.map((s, idx) => (
            <Bar
              key={s.name}
              dataKey={s.name}
              stackId="stack"
              fill={s.color}
              radius={idx === chart.series!.length - 1 ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {chart.x_label && (
        <p className="text-xs text-muted-foreground text-center mt-1">{chart.x_label}</p>
      )}
    </div>
  )
}
