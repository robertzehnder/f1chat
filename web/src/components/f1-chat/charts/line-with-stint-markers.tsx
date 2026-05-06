"use client"

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

interface LineWithStintMarkersProps {
  chart: {
    type: "line_with_stint_markers"
    x_label: string
    y_label: string
    series: Array<{
      name: string
      values: number[]
      color: string
    }>
    stint_boundaries?: Array<{
      lap: number
      label: string
    }>
    horizontal_marker?: {
      value: number
      label: string
    }
  }
}

export function LineWithStintMarkers({ chart }: LineWithStintMarkersProps) {
  const { x_label, y_label, series, stint_boundaries, horizontal_marker } = chart

  // Transform data for Recharts
  const maxLength = Math.max(...series.map(s => s.values.length))
  const data = Array.from({ length: maxLength }, (_, i) => {
    const point: Record<string, number> = { lap: i + 1 }
    series.forEach(s => {
      if (s.values[i] !== undefined) {
        point[s.name] = s.values[i]
      }
    })
    return point
  })

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis
            dataKey="lap"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            label={{
              value: x_label,
              position: "bottom",
              offset: 5,
              fill: "hsl(var(--muted-foreground))",
              fontSize: 10
            }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            label={{
              value: y_label,
              angle: -90,
              position: "insideLeft",
              fill: "hsl(var(--muted-foreground))",
              fontSize: 10
            }}
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
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
          />
          
          {/* Stint boundary markers */}
          {stint_boundaries?.map((boundary, idx) => (
            <ReferenceLine
              key={idx}
              x={boundary.lap}
              stroke="#E10600"
              strokeDasharray="4 4"
              strokeWidth={2}
              label={{
                value: boundary.label,
                position: "top",
                fill: "#E10600",
                fontSize: 9
              }}
            />
          ))}

          {/* Horizontal marker (e.g., zero line) */}
          {horizontal_marker && (
            <ReferenceLine
              y={horizontal_marker.value}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              label={{
                value: horizontal_marker.label,
                position: "right",
                fill: "hsl(var(--muted-foreground))",
                fontSize: 9
              }}
            />
          )}

          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: s.color }}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}
