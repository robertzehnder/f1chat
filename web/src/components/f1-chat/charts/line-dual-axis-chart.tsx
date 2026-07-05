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

  // The y2 series (rainfall, track temp, wet-track flag) renders as bars
  // on the right axis. Split by the spec's axis assignment — matching on
  // the literal name "Rainfall" put every other weather series on the
  // LEFT axis as a 0/1 line, dragging the lap-time domain down to ~0 and
  // flattening the actual pace trace.
  const rainfallSeries = chart.series.find(s => s.axis === "y2") ?? chart.series.find(s => s.name === "Rainfall")
  const lapSeries = chart.series.filter(s => s !== rainfallSeries)
  // OpenF1 carries NO rainfall intensity — its rainfall field and the
  // wet-track flag are both booleans. A binary y2 series renders as a
  // full-height translucent band ("track was wet on these laps"), with no
  // numeric ticks: a 0-2 axis with 0.5/1.5 marks implies a quantity that
  // doesn't exist in the data.
  const isBinaryWeather = !!rainfallSeries && rainfallSeries.values.every(v => v === 0 || v === 1)

  // Nice y1 ticks: fit the domain to the lap-time data, rounded outward
  // to a clean step — auto ticks on a 'dataMin - 2' domain land on values
  // like 87.337 / 137.337.
  const NICE_STEPS = [1, 2, 5, 10, 15, 20, 30, 60]
  const lapValues = lapSeries.flatMap(s => s.values).filter(v => Number.isFinite(v) && v > 0)
  const lapMin = lapValues.length ? Math.min(...lapValues) : 0
  const lapMax = lapValues.length ? Math.max(...lapValues) : 1
  const span = Math.max(lapMax - lapMin, 1)
  const step = NICE_STEPS.find(s => span / s <= 6) ?? 60
  const yLo = Math.floor((lapMin - 1) / step) * step
  const yHi = Math.ceil((lapMax + 1) / step) * step
  const yTicks: number[] = []
  for (let t = yLo; t <= yHi; t += step) yTicks.push(t)

  // Find max length
  const maxLen = Math.max(...chart.series.map(s => s.values.length))
  
  // Transform data for Recharts
  const data = Array.from({ length: maxLen }, (_, i) => {
    const entry: Record<string, number> = { lap: i + 1 }
    chart.series?.forEach((s) => {
      // F10: only plot finite values — a retired driver's missing laps are
      // NaN and must be omitted so the line terminates (connectNulls=false)
      // rather than dropping to 0 below the axis floor.
      if (Number.isFinite(s.values[i])) {
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
          // Zero gaps so a binary weather band reads as one continuous
          // region, not a per-lap barcode; extra top margin keeps the
          // pit-marker labels clear of the plot.
          barCategoryGap={0}
          barGap={0}
          margin={{ top: 24, right: isBinaryWeather ? 12 : 50, left: 10, bottom: 10 }}
        >
          <XAxis
            dataKey="lap"
            stroke="hsl(var(--chart-axis))"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--chart-grid))" }}
            interval={4}
            label={{ 
              value: "Lap", 
              position: "bottom", 
              offset: -5,
              style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } 
            }}
          />
          <YAxis
            yAxisId="left"
            stroke="hsl(var(--chart-axis))"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--chart-grid))" }}
            domain={[yLo, yHi]}
            ticks={yTicks}
            tickFormatter={(v: number) => String(Math.round(v))}
            label={{
              value: chart.y1_label || "Lap time (s)",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" }
            }}
          />
          {rainfallSeries && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#3B82F6"
              fontSize={10}
              tickLine={false}
              // Binary flag: no quantity to read, so hide the whole right
              // axis — the shaded band + legend swatch carry the meaning.
              hide={isBinaryWeather}
              tick={{ fontSize: 10 }}
              axisLine={{ stroke: "#3B82F6" }}
              domain={isBinaryWeather ? [0, 1] : [0, 'dataMax + 1']}
              label={
                isBinaryWeather
                  ? undefined
                  : {
                      value: chart.y2_label || "Rainfall",
                      angle: 90,
                      position: "insideRight",
                      style: { fontSize: 10, fill: "#3B82F6" }
                    }
              }
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
          
          {/* Vertical markers for pit stops. Labels alternate between two
              rows so adjacent-lap stops (double-stacked McLarens) don't
              overlap into unreadable strikethrough. */}
          {chart.vertical_markers?.map((marker, idx) => (
            <ReferenceLine
              key={idx}
              x={marker.x}
              yAxisId="left"
              stroke="hsl(var(--primary))"
              strokeDasharray="3 3"
              label={{
                value: marker.label,
                position: "top",
                dy: (idx % 2) * 12 - 8,
                fill: "hsl(var(--red-text))",
                fontSize: 9
              }}
            />
          ))}
          
          {/* Weather series as translucent bars on the right axis; binary
              flags become a full-height wet/dry band */}
          {rainfallSeries && (
            <Bar
              yAxisId="right"
              dataKey={rainfallSeries.name}
              fill="#3B82F6"
              opacity={isBinaryWeather ? 0.15 : 0.3}
              radius={isBinaryWeather ? 0 : [2, 2, 0, 0]}
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
              strokeWidth={s.strokeWidth ?? 2}
              strokeDasharray={s.strokeDasharray}
              dot={false}
              connectNulls={false}
              activeDot={{ r: 4, fill: s.color }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
