"use client"

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  ReferenceLine
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"

interface LineDualAxisChartProps {
  chart: ChartSpec
}

export function LineDualAxisChart({ chart }: LineDualAxisChartProps) {
  if (!chart.series) return null

  // Separate lap time series from rainfall series
  const lapSeries = chart.series.filter(s => s.name !== "Rainfall")
  const rainfallSeries = chart.series.find(s => s.name === "Rainfall")
  
  // Find max length
  const maxLen = Math.max(...chart.series.map(s => s.values.length))
  
  // Transform data for Recharts
  const data = Array.from({ length: maxLen }, (_, i) => {
    const entry: Record<string, number> = { lap: i + 1 }
    chart.series?.forEach((s) => {
      if (s.values[i] !== undefined) {
        entry[s.name] = s.values[i]
      }
    })
    return entry
  })

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 50, left: 10, bottom: 10 }}
        >
          <XAxis
            dataKey="lap"
            stroke="#6b7280"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: "#374151" }}
            interval={4}
            label={{ 
              value: "Lap", 
              position: "bottom", 
              offset: -5,
              style: { fontSize: 10, fill: "#9ca3af" } 
            }}
          />
          <YAxis
            yAxisId="left"
            stroke="#6b7280"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: "#374151" }}
            domain={['dataMin - 2', 'dataMax + 2']}
            label={{ 
              value: chart.y1_label || "Lap time (s)", 
              angle: -90, 
              position: "insideLeft",
              style: { fontSize: 10, fill: "#9ca3af" }
            }}
          />
          {rainfallSeries && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#3B82F6"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: "#3B82F6" }}
              domain={[0, 'dataMax + 1']}
              label={{ 
                value: chart.y2_label || "Rainfall", 
                angle: 90, 
                position: "insideRight",
                style: { fontSize: 10, fill: "#3B82F6" }
              }}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px"
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            itemStyle={{ color: "hsl(var(--muted-foreground))" }}
            labelFormatter={(value) => `Lap ${value}`}
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }}
          />
          
          {/* Vertical markers for pit stops */}
          {chart.vertical_markers?.map((marker, idx) => (
            <ReferenceLine
              key={idx}
              x={marker.x}
              yAxisId="left"
              stroke="#E10600"
              strokeDasharray="3 3"
              label={{
                value: marker.label,
                position: "top",
                fill: "#E10600",
                fontSize: 9
              }}
            />
          ))}
          
          {/* Rainfall as area/bar on right axis */}
          {rainfallSeries && (
            <Bar
              yAxisId="right"
              dataKey="Rainfall"
              fill="#3B82F6"
              opacity={0.3}
              radius={[2, 2, 0, 0]}
            />
          )}
          
          {/* Lap time lines on left axis */}
          {lapSeries.map((s) => (
            <Line
              key={s.name}
              yAxisId="left"
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: s.color }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
