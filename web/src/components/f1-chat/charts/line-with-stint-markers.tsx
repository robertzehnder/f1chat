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
import { formatChartValue } from "@/lib/f1-formatters"

interface LineWithStintMarkersProps {
  chart: {
    type: "line_with_stint_markers"
    x_label: string
    y_label: string
    y_value_format?: "lap_time_s" | "decimal_seconds" | "kph" | "percent"
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
  const { x_label, y_label, y_value_format, series, stint_boundaries, horizontal_marker } = chart
  const isLapTime = y_value_format === "lap_time_s"
  // Axis ticks: lap times as M:SS.s (one decimal keeps them short — e.g.
  // "1:21.7"); everything else via the shared formatter; fall back to 1dp.
  const fmtTick = (v: number): string => {
    if (!Number.isFinite(v)) return ""
    if (isLapTime) {
      const m = Math.floor(v / 60)
      const s = v - m * 60
      return `${m}:${s.toFixed(1).padStart(4, "0")}`
    }
    // Ticks land on nice steps (see yTicks below), so one decimal is
    // enough — "+1.0s" not "+1.000s". The tooltip keeps full precision.
    if (y_value_format === "decimal_seconds") {
      return `${v > 0 ? "+" : ""}${v.toFixed(1)}s`
    }
    return formatChartValue(v, y_value_format) || v.toFixed(1)
  }
  // Tooltip: full precision (M:SS.mmm for lap times).
  const fmtValue = (v: number): string => formatChartValue(v, y_value_format) || v.toFixed(2)

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

  // Fit the Y domain to the data instead of anchoring at 0 (lap times sit
  // at ~80s; a 0-based axis flattens the trend). Finite-only so NaN gaps
  // (pit / SC laps) don't skew the range. Then round the domain outward to
  // a "nice" step and emit the ticks explicitly — recharts' default ticks
  // on a raw fitted domain land on values like "-0.944s" / "1:46.187".
  const NICE_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30, 60]
  const finiteValues = series.flatMap(s => s.values).filter((v) => Number.isFinite(v))
  const minVal = finiteValues.length ? Math.min(...finiteValues) : 0
  const maxVal = finiteValues.length ? Math.max(...finiteValues) : 1
  const pad = Math.max((maxVal - minVal) * 0.05, 0.05)
  const span = Math.max(maxVal + pad - (minVal - pad), 0.1)
  const step = NICE_STEPS.find((s) => span / s <= 6) ?? Math.ceil(span / 6 / 60) * 60
  const yLo = Math.floor((minVal - pad) / step) * step
  const yHi = Math.ceil((maxVal + pad) / step) * step
  const yTicks: number[] = []
  for (let t = yLo; t <= yHi + step / 2; t += step) yTicks.push(Number(t.toFixed(3)))
  const yDomain: [number, number] = [yLo, yHi]

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data}
          // Top margin reserves headroom for the stint-boundary labels
          // ("S2 Medium"), which render above the plot and clip at 10px.
          margin={{ top: 24, right: 10, left: 0, bottom: 20 }}
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
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={fmtTick}
            width={isLapTime ? 56 : 44}
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
            labelFormatter={(label) => `Lap ${label}`}
            formatter={(v: number, name: string) => [fmtValue(v), name]}
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

          {/* Horizontal marker (e.g., zero line). Label renders INSIDE the
              plot — position "right" puts it in the 10px right margin where
              anything longer than a character or two gets clipped. */}
          {horizontal_marker && (
            <ReferenceLine
              y={horizontal_marker.value}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              label={{
                value: horizontal_marker.label,
                position: "insideBottomRight",
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
