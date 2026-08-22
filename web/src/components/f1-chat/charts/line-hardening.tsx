"use client"

/**
 * Shared hardening for lap-axis line charts (chart-quality pass, 2026-08).
 *
 * LLM-generated SQL often returns SPARSE per-lap rows (a sample of
 * "interesting" laps). A plain recharts line then renders only the
 * consecutive runs — isolated laps become invisible and the chart looks
 * broken. These helpers make sparse data legible instead:
 *
 *   - gap-aware dots: isolated points (both neighbors missing) always get
 *     a dot; sparse series (<60% lap coverage) dot every point.
 *   - dashed gap bridges: an underlay line with connectNulls so the eye
 *     can follow the trend across gaps, visually distinct from real data.
 *   - ChartNote: the subdued honesty caption under the chart
 *     ("data covers 16 of 52 laps · 7 pit/outlier laps off-scale").
 *   - renderCautionBands: shaded SC/VSC/yellow lap ranges. Returned as an
 *     array of ReferenceArea elements because recharts inspects direct
 *     children — a wrapper component would not register.
 */

import { ReferenceArea } from "recharts"
import type { ChartSpec } from "@/lib/chart-types"

export function seriesDensity(values: number[]): number {
  if (values.length === 0) return 1
  return values.filter((v) => Number.isFinite(v)).length / values.length
}

export function hasInteriorGap(values: number[]): boolean {
  const first = values.findIndex((v) => Number.isFinite(v))
  let last = -1
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) {
      last = i
      break
    }
  }
  if (first < 0 || last <= first) return false
  for (let i = first + 1; i < last; i += 1) {
    if (!Number.isFinite(values[i])) return true
  }
  return false
}

/**
 * Dot renderer factory. recharts calls the dot fn for every rendered
 * point with {cx, cy, index}; we consult the source values to decide.
 * Always returns an element (recharts' fn-dot contract) — hidden dots
 * render as an empty <g/>.
 */
export function makeGapAwareDot(
  values: number[],
  color: string
): (props: { cx?: number; cy?: number; index?: number; key?: string }) => React.ReactElement<SVGElement> {
  const sparse = seriesDensity(values) < 0.6
  return function GapAwareDot(props) {
    const { cx, cy, index, key } = props
    if (cx === undefined || cy === undefined || index === undefined) {
      return (<g key={key} />) as React.ReactElement<SVGElement>
    }
    const isolated =
      Number.isFinite(values[index]) &&
      !Number.isFinite(values[index - 1] ?? NaN) &&
      !Number.isFinite(values[index + 1] ?? NaN)
    if (!sparse && !isolated) {
      return (<g key={key} />) as React.ReactElement<SVGElement>
    }
    return (
      <circle key={key} cx={cx} cy={cy} r={2.5} fill={color} stroke="none" />
    ) as React.ReactElement<SVGElement>
  }
}

/** Shaded caution ranges. Spread the result directly into the chart JSX. */
export function renderCautionBands(
  bands: ChartSpec["caution_bands"]
): React.ReactElement[] {
  if (!bands || bands.length === 0) return []
  return bands.map((band, i) => (
    <ReferenceArea
      key={`caution-${i}`}
      x1={band.from - 0.5}
      x2={band.to + 0.5}
      fill="#EAB308"
      fillOpacity={0.08}
      stroke="#EAB308"
      strokeOpacity={0.25}
      strokeDasharray="2 4"
      label={
        band.label
          ? { value: band.label, position: "insideTop", fill: "#EAB308", fontSize: 9, opacity: 0.8 }
          : undefined
      }
    />
  ))
}

export function ChartNote({ note }: { note?: string }) {
  if (!note) return null
  return (
    <p className="text-[10px] text-muted-foreground/80 text-center mt-1">{note}</p>
  )
}
