"use client"

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"

/** Position changes: every driver's position per lap, grid (lap 0) to
 *  flag. Inverted y (P1 on top); unclassified cars' lines stop at their
 *  last recorded lap. */
export function PositionChangesChart({ chart }: { chart: ChartSpec }) {
  const series = chart.series ?? []
  if (series.length === 0) return null
  const maxLen = Math.max(...series.map((s) => s.values.length))
  const data = Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number> = { lap: i }
    series.forEach((s) => {
      const v = s.values[i]
      if (Number.isFinite(v)) point[s.name] = v
    })
    return point
  })
  const maxPos = Math.max(...series.flatMap((s) => s.values).filter((v) => Number.isFinite(v)), 10)

  return (
    <div className="space-y-2">
      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              dataKey="lap"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              label={{ value: "Lap (0 = grid)", position: "bottom", offset: 0, fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            />
            <YAxis
              reversed
              domain={[1, maxPos]}
              ticks={Array.from({ length: Math.ceil(maxPos / 2) }, (_, i) => i * 2 + 1)}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={32}
              tickFormatter={(v: number) => `P${v}`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
              labelFormatter={(label) => (Number(label) === 0 ? "Grid" : `Lap ${label}`)}
              formatter={(v: number, name: string) => [`P${v}`, name]}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              itemStyle={{ color: "hsl(var(--muted-foreground))" }}
            />
            {series.map((s) => {
              // emphasis: true → the story drivers (winner / biggest mover / faller)
              // render bold; false → the rest of the field is dimmed so the eye
              // follows the narrative; undefined → no story subset, all equal.
              const dimmed = s.emphasis === false
              return (
                <Line
                  key={s.name}
                  type="stepAfter"
                  dataKey={s.name}
                  stroke={s.color}
                  strokeWidth={s.emphasis === true ? 2.6 : 1.6}
                  strokeOpacity={dimmed ? 0.28 : 1}
                  dot={false}
                />
              )
            })}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span
            key={s.name}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            style={{ opacity: s.emphasis === false ? 0.4 : 1, fontWeight: s.emphasis === true ? 600 : 400 }}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
