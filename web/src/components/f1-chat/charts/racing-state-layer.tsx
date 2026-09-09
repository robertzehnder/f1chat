"use client"

/**
 * Racing-state layer renderer — ONE visual grammar for SC / VSC / red-flag
 * periods and sector-yellow observations on every lap-axis chart (visuals
 * plan S1.1, 2026-09-09; revised after the GPT-6 Astra visual review).
 * Spread the returned elements directly into a recharts chart (recharts
 * inspects direct children).
 *
 * Layout: three lanes, all lap-aligned.
 *   ANNOTATION LANE (above the plot, in the chart's top margin — charts
 *     reserve LANE_TOP px): period labels, the cluster callout
 *     "L3–4: SC → RED → SC · restart behind SC L4", "end inferred" tags.
 *   PLOT: the bands themselves — red hatched, SC solid amber, VSC lighter
 *     amber with dashed edges; overlapping periods draw as thin strips
 *     stacked in time order over a faint union band, labels suppressed
 *     (the callout carries the sequence).
 *   SECTOR-ALERT LANE (bottom edge of the plot, separated by a rule and a
 *     tinted background; charts pad the y domain so no data enters it):
 *     one bright bar per (lap, sector) single yellow, two parallel bars for
 *     a double yellow; a lap with more than three flagged sectors collapses
 *     to one block with a count ("8 = sectors flagged"), staggered when
 *     neighbours collide.
 *
 * Bands use custom `shape` renderers so the geometry is ours: recharts
 * hands the computed plot rect for x1..x2 and we draw inside/around it.
 */

import { ReferenceArea } from "recharts"
import type { RacingStateLayer, RacingStatePeriod, SectorFlagObservation } from "@/lib/chart-types"
import { isInferredEnd } from "@/lib/racingState/build"

const AMBER = "hsl(var(--semantic-warning))"
const RED = "hsl(var(--semantic-negative))"
const YELLOW = "#FACC15"
const INK = "hsl(var(--muted-foreground))"
const HATCH_ID = "racing-state-red-hatch"

/** Top margin the host chart must reserve for the annotation lane: a text
 *  row (callouts, labels) above a strip row where overlap clusters draw their
 *  chronological strips, so they never sit under driver lines or pit dots. */
export const LANE_TOP = 52
const STRIP_H = 9
const STRIP_GAP = 2
const TEXT_ROW_Y = 40 // baseline offset above the plot top for cluster callouts
/** Height of the sector-alert lane along the bottom edge of the plot. */
export const SECTOR_LANE_H = 20

type ShapeProps = { x?: number; y?: number; width?: number; height?: number }

const KIND_LABEL: Record<RacingStatePeriod["kind"], string> = { sc: "SC", vsc: "VSC", red: "RED" }
const kindColor = (k: RacingStatePeriod["kind"]): string => (k === "red" ? RED : AMBER)

function lapSpan(from: number, to: number | null): string {
  return to == null ? `L${from}+` : to === from ? `L${from}` : `L${from}–${to}`
}

/** Category-axis-safe geometry (see S1.1 notes): lap axes are recharts
 *  CATEGORY axes whose scale maps each lap to its tick centre — fractional
 *  x collapses to width 0. Bands are declared as [from, anchor] with integer
 *  laps and the shape derives one lap's width from the rect it receives. */
function bandCoords(from: number, to: number, lastLap: number): { x1: number; x2: number; laps: number; anchorBefore: boolean } {
  const laps = Math.max(1, to - from + 1)
  if (laps > 1) return { x1: from, x2: to, laps, anchorBefore: false }
  if (from >= lastLap && from > 0) return { x1: from - 1, x2: from, laps: 1, anchorBefore: true }
  return { x1: from, x2: from + 1, laps: 1, anchorBefore: false }
}
type Coords = ReturnType<typeof bandCoords>

function lapRect(rect: ShapeProps, coords: Coords): { x: number; width: number; band: number } {
  const { x = 0, width = 0 } = rect
  const span = Math.max(1, coords.x2 - coords.x1)
  const band = width / span
  if (!Number.isFinite(band) || band <= 0) return { x, width, band: 0 }
  const centre = coords.anchorBefore ? x + width : x
  return { x: centre - band / 2, width: coords.laps * band, band }
}

/** Time-ordered clusters of periods whose lap ranges intersect. */
function clusterPeriods(periods: RacingStatePeriod[], lastLap: number): RacingStatePeriod[][] {
  const sorted = [...periods].sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  const span = (p: RacingStatePeriod): [number, number] => [p.from_lap, Math.min(p.to_lap ?? lastLap, lastLap)]
  const clusters: RacingStatePeriod[][] = []
  for (const p of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && last.some((q) => span(p)[0] <= span(q)[1] && span(p)[1] >= span(q)[0])) last.push(p)
    else clusters.push([p])
  }
  return clusters
}

// ---------------------------------------------------------------- shapes

function BandShape({ p, index, cluster, coords, ...rect }: ShapeProps & { p: RacingStatePeriod; index: number; cluster: number; coords: Coords }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const stacked = cluster > 1
  // Cluster members draw as strips in the lane's strip row (above the data
  // rectangle, below the callout text), stacked in time order.
  const top = stacked ? y - 3 - (cluster - index) * (STRIP_H + STRIP_GAP) + STRIP_GAP : y
  const h = stacked ? STRIP_H : height - SECTOR_LANE_H
  const inferred = isInferredEnd(p.endpoint_inferred) || p.to_lap == null
  const fill = kindColor(p.kind)
  const fillOpacity = p.kind === "red" ? 0.16 : p.kind === "sc" ? 0.2 : 0.11
  return (
    <g>
      <rect x={x} y={top} width={width} height={h} fill={fill} fillOpacity={stacked ? fillOpacity + 0.18 : fillOpacity} />
      {p.kind === "red" && <rect x={x} y={top} width={width} height={h} fill={`url(#${HATCH_ID})`} opacity={stacked ? 0.7 : 0.5} />}
      {p.kind === "vsc" && (
        <>
          <line x1={x} x2={x} y1={top} y2={top + h} stroke={AMBER} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.9} />
          {!inferred && <line x1={x + width} x2={x + width} y1={top} y2={top + h} stroke={AMBER} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.9} />}
        </>
      )}
      {inferred && <line x1={x + width} x2={x + width} y1={top} y2={top + h} stroke={fill} strokeWidth={1.4} strokeDasharray="1 3" opacity={0.95} />}
      {/* Single period: label centred over the band just above the plot; the
          inferred-end tag hangs off the RIGHT dotted edge with a leader so it
          cannot be read as belonging to the start. */}
      {!stacked && (
        <g>
          <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={fill}>
            {`${KIND_LABEL[p.kind]} ${lapSpan(p.from_lap, p.to_lap)}`}
          </text>
          {inferred && (
            // A separate, higher text row so it never crowds the period label:
            // dotted leader up the right edge, then a short arm to the text.
            <g>
              <line x1={x + width} x2={x + width} y1={y - 26} y2={y} stroke={fill} strokeWidth={1} strokeDasharray="1 2" opacity={0.9} />
              <line x1={x + width} x2={x + width + 5} y1={y - 26} y2={y - 26} stroke={fill} strokeWidth={1} opacity={0.9} />
              <text x={x + width + 7} y={y - 23} fontSize={8} fill={fill} opacity={0.95}>end inferred</text>
            </g>
          )}
          {p.kind === "red" && p.to_lap != null && <RestartTag x={x + width} y={y} label={`restart · L${p.to_lap}`} />}
        </g>
      )}
      <title>{`${KIND_LABEL[p.kind]} ${lapSpan(p.from_lap, p.to_lap)}${inferred ? " · end inferred" : ""}`}</title>
    </g>
  )
}

function RestartTag({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={y - 14} y2={y} stroke={RED} strokeWidth={1} strokeDasharray="2 2" opacity={0.9} />
      <text x={x + 3} y={y - 6} fontSize={8.5} fill={RED} opacity={0.95}>{label}</text>
    </g>
  )
}

/** One callout per overlap cluster: faint union band in the plot, a
 *  connector, and "L3–4: SC → RED → SC · restart behind SC L4" in the lane
 *  with coloured tokens. */
function ClusterShape({ members, coords, ...rect }: ShapeProps & { members: RacingStatePeriod[]; coords: Coords }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const from = Math.min(...members.map((m) => m.from_lap))
  const to = Math.max(...members.map((m) => m.to_lap ?? m.from_lap))
  const red = members.find((m) => m.kind === "red")
  const restartBehindSc = red && red.to_lap != null && members.some((m) => m.kind === "sc" && m.from_lap === red.to_lap)
  const restart = red && red.to_lap != null ? ` · restart${restartBehindSc ? " behind SC" : ""} L${red.to_lap}` : ""
  const inferred = members.filter((m) => isInferredEnd(m.endpoint_inferred) || m.to_lap == null)
  return (
    <g>
      <rect x={x} y={y} width={width} height={height - SECTOR_LANE_H} fill={AMBER} fillOpacity={0.05} />
      <line x1={x} x2={x} y1={y - TEXT_ROW_Y - 8} y2={y} stroke={INK} strokeWidth={1} opacity={0.7} />
      <text x={x + 3} y={y - TEXT_ROW_Y} fontSize={9.5} fontWeight={600} fill={INK}>
        <tspan>{`${lapSpan(from, to)}: `}</tspan>
        {members.map((m, i) => (
          <tspan key={i}>
            {i > 0 && <tspan fill={INK}>{" → "}</tspan>}
            <tspan fill={kindColor(m.kind)}>{KIND_LABEL[m.kind]}</tspan>
          </tspan>
        ))}
        {restart && <tspan fill={RED}>{restart}</tspan>}
        {inferred.length > 0 && <tspan fill={INK} fontWeight={400}>{` · ${inferred.map((m) => `${KIND_LABEL[m.kind]} end inferred`).join(", ")}`}</tspan>}
      </text>
      <title>{`${lapSpan(from, to)}: ${members.map((m) => `${KIND_LABEL[m.kind]} ${lapSpan(m.from_lap, m.to_lap)}`).join(" → ")}${restart}`}</title>
    </g>
  )
}

type LapTicks = { lap: number; flags: SectorFlagObservation[]; stagger: boolean }

/** Lane background + rule + label, drawn once across every lap. */
function SectorLaneShape({ coords, ...rect }: ShapeProps & { coords: Coords }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const top = y + height - SECTOR_LANE_H
  return (
    <g>
      <rect x={x} y={top} width={width} height={SECTOR_LANE_H} fill={INK} fillOpacity={0.07} />
      <line x1={x} x2={x + width} y1={top} y2={top} stroke={INK} strokeWidth={0.8} opacity={0.6} />
      <text x={x + width - 3} y={top + 8} textAnchor="end" fontSize={7.5} fill={INK} opacity={0.9}>sector yellows (issued)</text>
    </g>
  )
}

function SectorTicksShape({ ticks, coords, ...rect }: ShapeProps & { ticks: LapTicks; coords: Coords }) {
  const { y = 0, height = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const base = y + height - 2
  const barW = Math.max(2, width - 2)
  const bx = x + 1
  const n = ticks.flags.length
  const anyDouble = ticks.flags.some((f) => f.level === "double_yellow")
  const tip = `Lap ${ticks.lap}: ${ticks.flags.map((f) => `${f.level === "double_yellow" ? "double yellow" : "yellow"} S${f.sector}`).join(", ")} (issued)`
  if (n > 3) {
    // collapsed: one block, a count, and a double-yellow indicator if any
    const blockH = 8
    return (
      <g>
        <rect x={bx} y={base - blockH} width={barW} height={blockH} fill={YELLOW} opacity={0.95} />
        {anyDouble && <line x1={bx} x2={bx + barW} y1={base - blockH / 2} y2={base - blockH / 2} stroke="#111" strokeWidth={1.2} />}
        <text x={bx + barW / 2} y={base - blockH - (ticks.stagger ? 8 : 2)} textAnchor="middle" fontSize={7.5} fontWeight={600} fill={YELLOW}>{n}</text>
        {ticks.stagger && <line x1={bx + barW / 2} x2={bx + barW / 2} y1={base - blockH - 7} y2={base - blockH} stroke={YELLOW} strokeWidth={0.6} opacity={0.8} />}
        <title>{tip}</title>
      </g>
    )
  }
  // up to three sectors: one bar (single) or two parallel bars (double) per sector, stacked
  const rowH = 5
  return (
    <g>
      {ticks.flags.map((f, i) => {
        const yy = base - (i + 1) * rowH
        return f.level === "double_yellow" ? (
          <g key={i}>
            <rect x={bx} y={yy} width={barW} height={1.6} fill={YELLOW} />
            <rect x={bx} y={yy + 2.4} width={barW} height={1.6} fill={YELLOW} />
          </g>
        ) : (
          <rect key={i} x={bx} y={yy + 0.8} width={barW} height={2.4} fill={YELLOW} />
        )
      })}
      <title>{tip}</title>
    </g>
  )
}

// ---------------------------------------------------------------- public API

/** Elements to spread into a lap-axis recharts chart. `lastLap` = the last
 *  lap category on the x axis; `firstLap` = the first (0 for grid-origin
 *  position charts, 1 otherwise). The host reserves LANE_TOP in its top
 *  margin and pads its y domain by SECTOR_LANE_H worth of space. */
export function renderRacingStateLayer(state: RacingStateLayer | undefined, lastLap: number, firstLap = 1): React.ReactElement[] {
  if (!state) return []
  if (state.source === "absent" || state.source === "failed") return []
  const out: React.ReactElement[] = [
    <defs key="rs-defs">
      <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={6} stroke={RED} strokeWidth={2} />
      </pattern>
    </defs>
  ]
  // sector lane first so bands draw over its background
  if (state.sector_flags.length) {
    const laneCoords = bandCoords(firstLap, lastLap, lastLap)
    out.push(
      <ReferenceArea key="rs-sector-lane" x1={laneCoords.x1} x2={laneCoords.x2} ifOverflow="visible" shape={(props: ShapeProps) => <SectorLaneShape coords={laneCoords} {...props} />} />
    )
  }
  const visible = state.periods
    .filter((p) => (p.to_lap ?? lastLap) >= firstLap && p.from_lap <= lastLap)
    .map((p) => (p.from_lap < firstLap ? { ...p, from_lap: firstLap } : p))
  for (const members of clusterPeriods(visible, lastLap)) {
    if (members.length > 1) {
      const from = Math.min(...members.map((m) => m.from_lap))
      const to = Math.min(Math.max(...members.map((m) => m.to_lap ?? lastLap)), lastLap)
      const coords = bandCoords(from, to, lastLap)
      out.push(
        <ReferenceArea key={`rs-cluster-${from}-${to}`} x1={coords.x1} x2={coords.x2} ifOverflow="visible" shape={(props: ShapeProps) => <ClusterShape members={members} coords={coords} {...props} />} />
      )
    }
    members.forEach((p, index) => {
      const to = Math.min(p.to_lap ?? lastLap, lastLap)
      const coords = bandCoords(p.from_lap, to, lastLap)
      out.push(
        <ReferenceArea
          key={`rs-${p.kind}-${p.from_lap}-${p.start_ts}`}
          x1={coords.x1}
          x2={coords.x2}
          ifOverflow="visible"
          shape={(props: ShapeProps) => <BandShape p={p} index={index} cluster={members.length} coords={coords} {...props} />}
        />
      )
    })
  }
  const byLap = new Map<number, LapTicks>()
  for (const f of state.sector_flags) {
    if (f.lap > lastLap || f.lap < firstLap) continue
    const t = byLap.get(f.lap) ?? { lap: f.lap, flags: [], stagger: false }
    t.flags.push(f)
    byLap.set(f.lap, t)
  }
  // stagger count labels on adjacent collapsed laps so they do not collide
  const lapsSorted = [...byLap.keys()].sort((a, b) => a - b)
  let flip = false
  for (let i = 0; i < lapsSorted.length; i++) {
    const t = byLap.get(lapsSorted[i])!
    const prev = i > 0 ? byLap.get(lapsSorted[i - 1])! : null
    if (t.flags.length > 3 && prev && prev.flags.length > 3 && lapsSorted[i] - lapsSorted[i - 1] <= 2) { flip = !flip; t.stagger = flip }
    else flip = false
  }
  for (const ticks of byLap.values()) {
    ticks.flags.sort((a, b) => a.sector - b.sector)
    const coords = bandCoords(ticks.lap, ticks.lap, lastLap)
    out.push(
      <ReferenceArea key={`rs-sector-${ticks.lap}`} x1={coords.x1} x2={coords.x2} ifOverflow="visible" shape={(props: ShapeProps) => <SectorTicksShape ticks={ticks} coords={coords} {...props} />} />
    )
  }
  return out
}

/** Legend entries that reproduce the chart's actual marks. */
export function RacingStateLegend({ state }: { state?: RacingStateLayer }) {
  if (!state || state.source === "absent" || state.source === "failed") return null
  const kinds = new Set(state.periods.map((p) => p.kind))
  const inferred = state.periods.some((p) => isInferredEnd(p.endpoint_inferred) || p.to_lap == null)
  const distinctSectors = new Set(state.sector_flags.map((f) => f.sector))
  const anyDouble = state.sector_flags.some((f) => f.level === "double_yellow")
  const anyCollapsed = [...state.sector_flags.reduce((m, f) => m.set(f.lap, (m.get(f.lap) ?? 0) + 1), new Map<number, number>()).values()].some((n) => n > 3)
  const item = (key: string, swatch: React.ReactNode, label: string) => (
    <span key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {swatch}
      {label}
    </span>
  )
  const sw = (children: React.ReactNode) => (
    <svg width={18} height={10} aria-hidden="true">
      <defs>
        <pattern id={`${HATCH_ID}-legend`} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={4} stroke={RED} strokeWidth={1.4} />
        </pattern>
      </defs>
      {children}
    </svg>
  )
  const items: React.ReactNode[] = []
  if (kinds.has("red")) items.push(item("red", sw(<><rect width={18} height={10} fill={RED} fillOpacity={0.25} /><rect width={18} height={10} fill={`url(#${HATCH_ID}-legend)`} opacity={0.7} /></>), "red flag (race stopped)"))
  if (kinds.has("sc")) items.push(item("sc", sw(<rect width={18} height={10} fill={AMBER} fillOpacity={0.45} />), "safety car"))
  if (kinds.has("vsc")) items.push(item("vsc", sw(<><rect width={18} height={10} fill={AMBER} fillOpacity={0.2} /><line x1={0.6} x2={0.6} y1={0} y2={10} stroke={AMBER} strokeWidth={1.2} strokeDasharray="2 2" /><line x1={17.4} x2={17.4} y1={0} y2={10} stroke={AMBER} strokeWidth={1.2} strokeDasharray="2 2" /></>), "virtual safety car"))
  if (inferred) items.push(item("inf", sw(<><rect width={12} height={10} fill={AMBER} fillOpacity={0.3} /><line x1={12} x2={12} y1={0} y2={10} stroke={AMBER} strokeWidth={1.4} strokeDasharray="1 2" /></>), "dotted edge = end inferred"))
  if (state.sector_flags.length) {
    items.push(item("sy1", sw(<rect x={2} y={4} width={14} height={2.4} fill={YELLOW} />), "single yellow (sector)"))
    if (anyDouble) items.push(item("sy2", sw(<><rect x={2} y={2.5} width={14} height={1.6} fill={YELLOW} /><rect x={2} y={5.5} width={14} height={1.6} fill={YELLOW} /></>), "double yellow"))
    if (anyCollapsed) items.push(item("syn", sw(<><rect x={2} y={2} width={14} height={8} fill={YELLOW} opacity={0.95} /><text x={9} y={8.5} textAnchor="middle" fontSize={7} fontWeight={700} fill="#111">n</text></>), "n = sectors flagged that lap"))
    items.push(item("syc", <span />, `sector-yellow observations · ${distinctSectors.size} distinct sector${distinctSectors.size === 1 ? "" : "s"}`))
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

function AnnotationShape({ text, kind, coords, row, anchor, ...rect }: ShapeProps & { text: string; kind?: string; coords: Coords; row: number; anchor: "start" | "middle" | "end" }) {
  const { y = 0 } = rect
  const { x, width } = lapRect(rect, coords)
  const cx = x + width / 2
  const color = kind === "deletion" ? RED : kind === "pass" ? "hsl(var(--semantic-positive))" : INK
  const top = y - 16 - row * 13
  return (
    <g>
      <line x1={cx} x2={cx} y1={top} y2={y} stroke={color} strokeWidth={1} strokeDasharray="2 2" opacity={0.9} />
      <text x={cx + (anchor === "start" ? 3 : anchor === "end" ? -3 : 0)} y={top - 3} textAnchor={anchor} fontSize={8.5} fill={color} opacity={0.95}>{text}</text>
      <title>{text}</title>
    </g>
  )
}

/** Lap-anchored notes in the annotation lane (a deletion, a pass). */
export function renderAnnotations(annotations: ChartSpecAnnotations | undefined, lastLap: number, firstLap = 1): React.ReactElement[] {
  if (!annotations?.length) return []
  const visible = annotations.filter((a) => a.lap >= firstLap && a.lap <= lastLap).sort((a, b) => a.lap - b.lap)
  const span = Math.max(1, lastLap - firstLap)
  return visible.map((a, i) => {
    const coords = bandCoords(a.lap, a.lap, lastLap)
    // neighbours within ~12% of the axis alternate rows; labels near the
    // right edge anchor "end" so they never overflow the plot
    const row = i > 0 && a.lap - visible[i - 1].lap <= span * 0.12 ? (i % 2) : 0
    const anchor: "start" | "middle" | "end" = (a.lap - firstLap) / span > 0.85 ? "end" : (a.lap - firstLap) / span < 0.1 ? "start" : "middle"
    return <ReferenceArea key={`ann-${a.lap}-${a.text}`} x1={coords.x1} x2={coords.x2} ifOverflow="visible" shape={(props: ShapeProps) => <AnnotationShape text={a.text} kind={a.kind} coords={coords} row={row} anchor={anchor} {...props} />} />
  })
}
type ChartSpecAnnotations = NonNullable<import("@/lib/chart-types").ChartSpec["annotations"]>
