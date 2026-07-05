"use client"

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot,
  ResponsiveContainer
} from "recharts"
import type { ChartSpec } from "@/lib/chart-types"

/**
 * The "cliff" for a compound is where its degradation curve steepens sharply —
 * the tyre age at which the per-lap slope jumps most vs the stint's baseline
 * slope. Computed from the series itself (no extra data needed); only flagged
 * when the jump clears a real threshold so noisy curves don't get a false pin.
 */
function cliffAge(values: number[]): number | null {
  const v = values.map((x) => (Number.isFinite(x) ? x : null))
  const slopes: Array<{ age: number; slope: number }> = []
  for (let i = 1; i < v.length; i++) {
    if (v[i] == null || v[i - 1] == null) continue
    slopes.push({ age: i, slope: (v[i] as number) - (v[i - 1] as number) })
  }
  if (slopes.length < 3) return null
  const median = [...slopes].sort((a, b) => a.slope - b.slope)[Math.floor(slopes.length / 2)].slope
  let best = slopes[0]
  for (const s of slopes) if (s.slope > best.slope) best = s
  // Cliff only if the steepest lap is meaningfully worse than the typical slope.
  if (best.slope < median + 0.12 || best.slope < 0.08) return null
  return best.age
}

/** Compound degradation curves: median lap-time delta vs tyre age, one
 *  line per compound in its tyre color. */
export function DegradationCurveChart({ chart }: { chart: ChartSpec }) {
  const series = chart.series ?? []
  if (series.length === 0) return null
  const maxLen = Math.max(...series.map((s) => s.values.length))
  const data = Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number> = { age: i }
    series.forEach((s) => {
      const v = s.values[i]
      if (Number.isFinite(v)) point[s.name] = v
    })
    return point
  })

  // Per-compound cliff markers (age + the value at that age).
  const cliffs = series
    .map((s) => {
      const age = cliffAge(s.values)
      return age != null ? { age, value: s.values[age], color: s.color, name: s.name } : null
    })
    .filter((c): c is { age: number; value: number; color: string; name: string } => c != null && Number.isFinite(c.value))

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis
            dataKey="age"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            label={{ value: chart.x_label ?? "Tyre age (laps)", position: "bottom", offset: 0, fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            width={44}
            tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
            label={{ value: chart.y_label ?? "Δ (s)", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
            labelFormatter={(label) => `Tyre age ${label}`}
            formatter={(v: number, name: string) => [`${v > 0 ? "+" : ""}${v.toFixed(3)}s`, name]}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            itemStyle={{ color: "hsl(var(--muted-foreground))" }}
          />
          <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 2, fill: s.color }}
              connectNulls
            />
          ))}
          {/* Cliff markers — where each compound falls off a cliff. */}
          {cliffs.map((c) => (
            <ReferenceDot
              key={`cliff-${c.name}`}
              x={c.age}
              y={c.value}
              r={5}
              fill={c.color}
              stroke="hsl(var(--background))"
              strokeWidth={2}
              label={{ value: `cliff · L${c.age}`, position: "top", fill: c.color, fontSize: 9, fontWeight: 700 }}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}
