"use client"

import { useEffect, useState } from "react"

/**
 * Shared track-map renderer + outline fetching hook. The outline (circuit
 * shape derived from a reference lap's location telemetry) comes from
 * /api/track-outline; this component draws it as a broadcast-style ribbon
 * in one of three modes:
 *
 *   segments   — every part of the lap colored by a segment owner
 *                (sector/minisector dominance)
 *   highlights — neutral ribbon with specific f-windows highlighted
 *                (brake zones, corner comparisons)
 *   gradient   — per-point coloring from a telemetry channel
 *                (speed map, traction zones)
 *
 * All modes support corner numbers, the start/finish dash, and DRS-zone
 * shading.
 */

export type OutlinePoint = {
  x: number
  y: number
  f: number
  speed?: number
  throttle?: number
  brake?: number
}
export type Outline = {
  circuit: string
  sessionKey: number
  driverNumber: number
  driverName: string | null
  lapDuration: number | null
  points: OutlinePoint[]
  corners: Array<{ label: string; f: number }>
  sectors: number[]
  drsZones: Array<[number, number]>
}

export function useTrackOutline(
  circuit: string | undefined,
  opts?: { sessionKey?: number; driver?: number; channels?: boolean }
): Outline | null | undefined {
  const [outline, setOutline] = useState<Outline | null | undefined>(circuit ? undefined : null)
  const sessionKey = opts?.sessionKey
  const driver = opts?.driver
  const channels = opts?.channels

  useEffect(() => {
    if (!circuit) {
      setOutline(null)
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ circuit })
    if (sessionKey) params.set("sessionKey", String(sessionKey))
    if (driver) params.set("driver", String(driver))
    if (channels) params.set("channels", "1")
    fetch(`/api/track-outline?${params.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<Outline>) : null))
      .then((data) => {
        if (!cancelled) setOutline(data && data.points?.length ? data : null)
      })
      .catch(() => {
        if (!cancelled) setOutline(null)
      })
    return () => {
      cancelled = true
    }
  }, [circuit, sessionKey, driver, channels])

  return outline
}

export function pointAt(points: OutlinePoint[], f: number): { x: number; y: number } {
  if (points.length === 0) return { x: 500, y: 500 }
  let lo = points[0]
  for (const p of points) {
    if (p.f >= f) {
      const span = p.f - lo.f || 1
      const t = (f - lo.f) / span
      return { x: lo.x + (p.x - lo.x) * t, y: lo.y + (p.y - lo.y) * t }
    }
    lo = p
  }
  return { x: points[points.length - 1].x, y: points[points.length - 1].y }
}

function pathFor(points: OutlinePoint[], f0: number, f1: number): string {
  const inner = points.filter((p) => p.f >= f0 && p.f <= f1)
  const start = pointAt(points, f0)
  const end = pointAt(points, f1)
  const pts = [start, ...inner, end]
  return pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
}

export type TrackMapProps = {
  outline: Outline
  /** segments mode: contiguous owner-colored chunks. boundaries optional —
   *  defaults to uniform splits; pass real fractions (e.g. sector lines). */
  segments?: Array<{ color: string; label: string }>
  segmentBoundaries?: number[]
  /** highlights mode: neutral ribbon + highlighted f-windows. */
  highlights?: Array<{ f0: number; f1: number; color: string; label: string }>
  /** gradient mode: color each step from a channel value. */
  gradient?: { channel: "speed" | "throttle_brake"; }
  /** point markers — the deck's pin (faded-outer + solid-inner) at a lap
   *  fraction f. Used by corner-on-map, telemetry biggest-Δ, incident pins. */
  markers?: Array<{ f: number; color: string; label?: string; r?: number }>
  showDrs?: boolean
  /** "mini" strips chrome (shadow / center stripe / start-finish / corner
   *  numbers) for dense multi-map grids (the 24-circuit coverage grid). */
  variant?: "full" | "mini"
  showCornerLabels?: boolean
  showStartFinish?: boolean
  className?: string
}

const NEUTRAL = "#3f3f46"

function gradientColor(channel: "speed" | "throttle_brake", p: OutlinePoint, min: number, max: number): string {
  if (channel === "throttle_brake") {
    // Braking red > full-throttle green > coasting grey.
    if ((p.brake ?? 0) > 30) return "#EF4444"
    if ((p.throttle ?? 0) > 90) return "#22C55E"
    return "#9CA3AF"
  }
  const v = p.speed
  if (v === undefined || !Number.isFinite(v)) return NEUTRAL
  const t = Math.max(0, Math.min(1, (v - min) / Math.max(max - min, 1)))
  // Blue (slow) → yellow → red (fast), broadcast-ish heat ramp.
  const hue = 240 - t * 240
  return `hsl(${hue.toFixed(0)}, 85%, 55%)`
}

export function TrackMap({
  outline,
  segments,
  segmentBoundaries,
  highlights,
  gradient,
  markers,
  showDrs,
  variant = "full",
  showCornerLabels,
  showStartFinish,
  className
}: TrackMapProps) {
  const points = outline.points
  const mini = variant === "mini"
  const withCornerLabels = showCornerLabels ?? !mini
  const withStartFinish = showStartFinish ?? !mini

  // Build the colored path chunks per mode.
  let chunks: Array<{ d: string; color: string; title?: string; width?: number }> = []
  if (segments && segments.length > 0) {
    const n = segments.length
    const boundaries =
      segmentBoundaries && segmentBoundaries.length === n + 1
        ? segmentBoundaries
        : Array.from({ length: n + 1 }, (_, i) => i / n)
    chunks = segments.map((seg, i) => ({
      d: pathFor(points, boundaries[i], boundaries[i + 1]),
      color: seg.color,
      title: seg.label
    }))
  } else if (gradient) {
    const speeds = points.map((p) => p.speed).filter((v): v is number => Number.isFinite(v ?? NaN))
    const min = speeds.length ? Math.min(...speeds) : 0
    const max = speeds.length ? Math.max(...speeds) : 1
    chunks = points.slice(0, -1).map((p, i) => ({
      d: `M${p.x.toFixed(1)} ${p.y.toFixed(1)} L${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`,
      color: gradientColor(gradient.channel, p, min, max)
    }))
  } else {
    chunks = [{ d: pathFor(points, 0, 1), color: NEUTRAL }]
  }

  const highlightChunks = (highlights ?? []).map((h) => ({
    d: pathFor(points, h.f0, h.f1),
    color: h.color,
    title: h.label,
    mid: pointAt(points, (h.f0 + h.f1) / 2)
  }))

  // Corner numbers, de-collided (earlier corners win).
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const cornerLabels = outline.corners
    .map((c) => {
      const p = pointAt(points, c.f)
      const dx = p.x - cx
      const dy = p.y - cy
      const len = Math.hypot(dx, dy) || 1
      const num = c.label.match(/\d+/)?.[0] ?? c.label
      return { num, x: p.x + (dx / len) * 34, y: p.y + (dy / len) * 34 }
    })
    .filter((c) => c.num)
    .filter((c, i, all) => all.findIndex((o) => Math.hypot(o.x - c.x, o.y - c.y) < 30) === i)

  const p0 = points[0]
  const p1 = points[Math.min(3, points.length - 1)]
  const tx = p1.x - p0.x
  const ty = p1.y - p0.y
  const tlen = Math.hypot(tx, ty) || 1
  const nx = -ty / tlen
  const ny = tx / tlen

  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className ?? (mini ? "w-full h-auto" : "w-full max-w-md mx-auto")}
      role="img"
      aria-label="Track map"
    >
      {/* Shadow pass for contrast (full only) */}
      {!mini && (
        <path d={pathFor(points, 0, 1)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* DRS zones: bright green under-band */}
      {showDrs &&
        outline.drsZones.map((z, i) => (
          <path key={`drs-${i}`} d={pathFor(points, z[0], z[1])} fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round">
            <title>DRS zone</title>
          </path>
        ))}
      {/* Base / segment / gradient ribbon */}
      {chunks.map((c, i) => (
        <path key={`seg-${i}`} d={c.d} fill="none" stroke={c.color} strokeWidth={c.width ?? 16} strokeLinecap="round" strokeLinejoin="round">
          {c.title ? <title>{c.title}</title> : null}
        </path>
      ))}
      {/* Highlighted corner windows on top */}
      {highlightChunks.map((c, i) => (
        <path key={`hl-${i}`} d={c.d} fill="none" stroke={c.color} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round">
          <title>{c.title}</title>
        </path>
      ))}
      {/* Center stripe (skip in gradient mode — muddies the ramp — and in mini) */}
      {!gradient && !mini && (
        <path d={pathFor(points, 0, 1)} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* Highlight labels */}
      {!mini && highlightChunks.map((c, i) => (
        <text key={`hll-${i}`} x={c.mid.x} y={c.mid.y - 24} fontSize={24} fontWeight={700} fill="hsl(var(--foreground))" textAnchor="middle">
          {c.title}
        </text>
      ))}
      {/* Point markers — the deck's pin: faded outer halo + solid inner dot. */}
      {(markers ?? []).map((mk, i) => {
        const p = pointAt(points, mk.f)
        const r = mk.r ?? 26
        return (
          <g key={`mk-${i}`}>
            <circle cx={p.x} cy={p.y} r={r * 1.9} fill={mk.color} opacity={0.18} />
            <circle cx={p.x} cy={p.y} r={r} fill={mk.color} stroke="hsl(var(--background))" strokeWidth={3} />
            {mk.label ? (
              <text x={p.x} y={p.y + r + 26} fontSize={24} fontWeight={700} fill="hsl(var(--foreground))" textAnchor="middle">
                {mk.label}
              </text>
            ) : null}
          </g>
        )
      })}
      {/* Start/finish */}
      {withStartFinish && (
        <line x1={p0.x - nx * 16} y1={p0.y - ny * 16} x2={p0.x + nx * 16} y2={p0.y + ny * 16} stroke="hsl(var(--foreground))" strokeWidth={6} strokeDasharray="4 4" />
      )}
      {/* Corner numbers */}
      {withCornerLabels && cornerLabels.map((c, i) => (
        <text key={`corner-${i}`} x={c.x} y={c.y} fontSize={26} fontWeight={700} fill="hsl(var(--muted-foreground))" textAnchor="middle" dominantBaseline="middle">
          {c.num}
        </text>
      ))}
    </svg>
  )
}
