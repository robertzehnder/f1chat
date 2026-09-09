"use client"

/**
 * Racing-state layer renderer — ONE visual grammar for SC / VSC / red-flag
 * periods and sector-yellow observations on every lap-axis chart (visuals
 * plan S1.1, 2026-09-09). Spread the returned elements directly into a
 * recharts chart (recharts inspects direct children).
 *
 *   red   hatched full-height band + restart rule at the resumption lap
 *   SC    solid amber band
 *   VSC   lighter amber band with dashed edges (the field does not bunch)
 *   inferred end   dotted terminal rule + "?" glyph; the note under the
 *                  chart says why (state.notes)
 *   overlap        periods sharing a lap (Monza 2026: SC → red → SC inside
 *                  laps 3–4) are drawn as thin strips stacked in time order
 *                  at the top of the plot — sequence is never merged
 *   sector yellows a strip of ticks along the bottom edge of the plot, one
 *                  per (lap, sector); single light / double dark; same-lap
 *                  ticks stack up to three rows, more collapse to a count
 *
 * Bands use custom `shape` renderers so the geometry is ours: recharts
 * hands the computed plot rect for x1..x2 and we draw inside it.
 */

import { ReferenceArea, ReferenceLine } from "recharts"
import type { RacingStateLayer, RacingStatePeriod } from "@/lib/chart-types"
import { isInferredEnd } from "@/lib/racingState/build"

const AMBER = "hsl(var(--semantic-warning))"
const RED = "hsl(var(--semantic-negative))"
const YELLOW_LIGHT = "#FACC15"
const YELLOW_DARK = "#A16207"
const HATCH_ID = "racing-state-red-hatch"

type ShapeProps = { x?: number; y?: number; width?: number; height?: number }

/**
 * Category-axis-safe geometry. The lap axes here are recharts CATEGORY axes
 * (dataKey="lap", no type), whose scale maps each lap to its tick CENTRE and
 * has no fractional positions — x1=2.5 collapses to width 0 at the left edge.
 * So every band is declared as [from, anchor] with integer laps and the shape
 * derives one lap's width from the rect it receives, then expands by half a
 * lap on each side so the band covers whole laps. For a single lap the anchor
 * is the next lap (or the previous one at the end of the axis).
 */
function bandCoords(from: number, to: number, lastLap: number): { x1: number; x2: number; laps: number; anchorBefore: boolean } {
  const laps = Math.max(1, to - from + 1)
  if (laps > 1) return { x1: from, x2: to, laps, anchorBefore: false }
  if (from >= lastLap && from > 0) return { x1: from - 1, x2: from, laps: 1, anchorBefore: true }
  return { x1: from, x2: from + 1, laps: 1, anchorBefore: false }
}

function lapRect(rect: ShapeProps, coords: ReturnType<typeof bandCoords>): { x: number; width: number } {
  const { x = 0, width = 0 } = rect
  const span = Math.max(1, coords.x2 - coords.x1)
  const band = width / span
  if (!Number.isFinite(band) || band <= 0) return { x, width }
  const centre = coords.anchorBefore ? x + width : x
  return { x: centre - band / 2, width: coords.laps * band }
}

const KIND_LABEL: Record<RacingStatePeriod["kind"], string> = { sc: "SC", vsc: "VSC", red: "RED" }

function periodLabel(p: RacingStatePeriod): string {
  const to = p.to_lap ?? null
  if (p.kind === "red") return to != null && to !== p.from_lap ? `RED L${p.from_lap}–${to}` : `RED L${p.from_lap}`
  return KIND_LABEL[p.kind]
}

/** Time-ordered stacking for periods whose lap ranges intersect. Returns,
 *  per period, its stack index and the size of its overlap cluster. */
function stackPeriods(periods: RacingStatePeriod[], lastLap: number): Array<{ p: RacingStatePeriod; index: number; cluster: number }> {
  const sorted = [...periods].sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  const span = (p: RacingStatePeriod): [number, number] => [p.from_lap, p.to_lap ?? lastLap]
  const clusters: RacingStatePeriod[][] = []
  for (const p of sorted) {
    const [a] = span(p)
    const last = clusters[clusters.length - 1]
    if (last && last.some((q) => a <= span(q)[1] && span(p)[1] >= span(q)[0])) last.push(p)
    else clusters.push([p])
  }
  return clusters.flatMap((c) => c.map((p, i) => ({ p, index: i, cluster: c.length })))
}

function PeriodShape({ p, index, cluster, coords, ...rect }: ShapeProps & { p: RacingStatePeriod; index: number; cluster: number; coords: ReturnType<typeof bandCoords> }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const stacked = cluster > 1
  const stripH = 11
  const top = stacked ? y + 2 + index * (stripH + 2) : y
  const h = stacked ? stripH : height
  const inferred = isInferredEnd(p.endpoint_inferred) || p.to_lap == null
  const fill = p.kind === "red" ? RED : AMBER
  const fillOpacity = p.kind === "red" ? 0.14 : p.kind === "sc" ? 0.2 : 0.11
  return (
    <g>
      {/* Overlap cluster: a faint full-height union behind the first strip so
          the plot still reads "interrupted" across the laps; the strips above
          carry the sequence and are never merged. */}
      {stacked && index === 0 && <rect x={x} y={y} width={width} height={height} fill={AMBER} fillOpacity={0.05} />}
      <rect x={x} y={top} width={width} height={h} fill={fill} fillOpacity={stacked ? fillOpacity + 0.12 : fillOpacity} />
      {p.kind === "red" && <rect x={x} y={top} width={width} height={h} fill={`url(#${HATCH_ID})`} opacity={0.45} />}
      {p.kind === "vsc" && (
        <>
          <line x1={x} x2={x} y1={top} y2={top + h} stroke={AMBER} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
          {!inferred && <line x1={x + width} x2={x + width} y1={top} y2={top + h} stroke={AMBER} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />}
        </>
      )}
      {inferred && (
        <>
          <line x1={x + width} x2={x + width} y1={top} y2={top + h} stroke={fill} strokeWidth={1.2} strokeDasharray="1 3" opacity={0.9} />
          <text x={x + width - 2} y={top + 9} textAnchor="end" fontSize={9} fill={fill} opacity={0.95}>?</text>
        </>
      )}
      <text x={x + 3} y={top + (stacked ? 8.5 : 10)} fontSize={stacked ? 8 : 9} fontWeight={stacked ? 600 : 400} fill={fill} opacity={0.95}>
        {periodLabel(p)}
      </text>
      <title>{`${periodLabel(p)} · laps ${p.from_lap}${p.to_lap != null ? `–${p.to_lap}` : "+"}${inferred ? " · end inferred" : ""}`}</title>
    </g>
  )
}

type LapTicks = { lap: number; flags: RacingStateLayer["sector_flags"] }

function SectorStripShape({ ticks, coords, ...rect }: ShapeProps & { ticks: LapTicks; coords: ReturnType<typeof bandCoords> }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const rowH = 4
  const rows = Math.min(ticks.flags.length, 3)
  const base = y + height - 1
  if (ticks.flags.length > 3) {
    return (
      <g>
        <rect x={x + 1} y={base - rowH * 3} width={Math.max(2, width - 2)} height={rowH * 3} fill={YELLOW_DARK} opacity={0.85} />
        <text x={x + width / 2} y={base - rowH * 3 - 2} textAnchor="middle" fontSize={7} fill={YELLOW_DARK}>{`×${ticks.flags.length}`}</text>
        <title>{`Lap ${ticks.lap}: yellow issued in ${ticks.flags.length} sectors (${ticks.flags.map((f) => `S${f.sector}`).join(", ")})`}</title>
      </g>
    )
  }
  return (
    <g>
      {ticks.flags.slice(0, rows).map((f, i) => (
        <rect
          key={`${f.sector}-${i}`}
          x={x + 1}
          y={base - (i + 1) * rowH}
          width={Math.max(2, width - 2)}
          height={rowH - 1}
          fill={f.level === "double_yellow" ? YELLOW_DARK : YELLOW_LIGHT}
          opacity={0.9}
        />
      ))}
      <title>
        {`Lap ${ticks.lap}: ${ticks.flags.map((f) => `${f.level === "double_yellow" ? "double yellow" : "yellow"} S${f.sector}`).join(", ")} (issued)`}
      </title>
    </g>
  )
}

/** Elements to spread into a lap-axis recharts chart. `lapOffset` = 0 when
 *  the x axis is the lap number (race trace, stint charts); position charts
 *  that put the grid at x=0 also use 0 — lap L is still at x=L. */
export function renderRacingStateLayer(state: RacingStateLayer | undefined, lastLap: number): React.ReactElement[] {
  if (!state) return []
  if (state.source === "absent" || state.source === "failed") return []
  const out: React.ReactElement[] = [
    <defs key="rs-defs">
      <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={6} stroke={RED} strokeWidth={2} />
      </pattern>
    </defs>
  ]
  for (const { p, index, cluster } of stackPeriods(state.periods, lastLap)) {
    const to = Math.min(p.to_lap ?? lastLap, lastLap)
    const coords = bandCoords(p.from_lap, to, lastLap)
    out.push(
      <ReferenceArea
        key={`rs-${p.kind}-${p.from_lap}-${p.start_ts}`}
        x1={coords.x1}
        x2={coords.x2}
        ifOverflow="visible"
        shape={(props: ShapeProps) => <PeriodShape p={p} index={index} cluster={cluster} coords={coords} {...props} />}
      />
    )
    if (p.kind === "red" && p.to_lap != null) {
      out.push(
        <ReferenceLine
          key={`rs-restart-${p.to_lap}`}
          x={p.to_lap}
          stroke={RED}
          strokeWidth={1.2}
          strokeDasharray="4 2"
          label={{ value: "restart", position: "insideTopRight", fill: RED, fontSize: 8, opacity: 0.9 }}
        />
      )
    }
  }
  const byLap = new Map<number, LapTicks>()
  for (const f of state.sector_flags) {
    const t = byLap.get(f.lap) ?? { lap: f.lap, flags: [] }
    t.flags.push(f)
    byLap.set(f.lap, t)
  }
  for (const ticks of byLap.values()) {
    ticks.flags.sort((a, b) => a.sector - b.sector)
    if (ticks.lap > lastLap) continue
    const coords = bandCoords(ticks.lap, ticks.lap, lastLap)
    out.push(
      <ReferenceArea
        key={`rs-sector-${ticks.lap}`}
        x1={coords.x1}
        x2={coords.x2}
        ifOverflow="visible"
        shape={(props: ShapeProps) => <SectorStripShape ticks={ticks} coords={coords} {...props} />}
      />
    )
  }
  return out
}

/** Legend swatches for whatever the layer actually contains. */
export function RacingStateLegend({ state }: { state?: RacingStateLayer }) {
  if (!state || state.source === "absent" || state.source === "failed") return null
  const kinds = new Set(state.periods.map((p) => p.kind))
  const inferred = state.periods.some((p) => isInferredEnd(p.endpoint_inferred) || p.to_lap == null)
  const distinctSectors = new Set(state.sector_flags.map((f) => f.sector))
  const item = (key: string, swatch: React.ReactNode, label: string) => (
    <span key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {swatch}
      {label}
    </span>
  )
  const items: React.ReactNode[] = []
  if (kinds.has("red")) items.push(item("red", <span className="size-2.5 rounded-sm" style={{ background: `repeating-linear-gradient(45deg, ${RED} 0 1px, transparent 1px 3px)`, backgroundColor: "rgba(239,68,68,0.2)" }} />, "red flag"))
  if (kinds.has("sc")) items.push(item("sc", <span className="size-2.5 rounded-sm bg-semantic-warning opacity-50" />, "safety car"))
  if (kinds.has("vsc")) items.push(item("vsc", <span className="size-2.5 rounded-sm border border-dashed border-semantic-warning bg-semantic-warning/20" />, "virtual safety car"))
  if (inferred) items.push(item("inf", <span className="text-[10px] font-semibold text-semantic-warning">?</span>, "end inferred"))
  if (state.sector_flags.length) {
    const label =
      distinctSectors.size <= 3
        ? `sector yellow issued (S${[...distinctSectors].sort((a, b) => a - b).join(", S")})`
        : `sector yellows issued (${distinctSectors.size} sectors)`
    items.push(item("sy", <span className="size-2.5 rounded-sm" style={{ background: `linear-gradient(${YELLOW_LIGHT} 50%, ${YELLOW_DARK} 50%)` }} />, label))
  }
  if (!items.length) return null
  return <>{items}</>
}

/** Notes to render under the chart, merged with the detector's chart_note. */
export function racingStateNotes(state: RacingStateLayer | undefined): string[] {
  return state?.notes ?? []
}

export function mergeChartNotes(...notes: Array<string | string[] | undefined>): string | undefined {
  const flat = notes.flatMap((n) => (Array.isArray(n) ? n : n ? [n] : [])).filter(Boolean)
  return flat.length ? flat.join(" · ") : undefined
}
