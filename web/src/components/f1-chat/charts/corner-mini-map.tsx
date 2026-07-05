"use client"

import { TrackMap, useTrackOutline } from "./track-map"

/**
 * A1 — single corner highlighted on the real circuit outline, beside the
 * corner-metrics tiles. Client-only: the corner's lap-fraction is resolved
 * from the runtime track-outline's `corners` array (matched by number/label),
 * so no extra SQL is needed — the card just carries circuit + corner id.
 * Renders nothing if the outline or the corner can't be resolved (honest).
 */
export function CornerMiniMap({
  circuit,
  cornerNumber,
  cornerLabel,
  color = "hsl(var(--primary))"
}: {
  circuit: string
  cornerNumber?: number
  cornerLabel?: string
  color?: string
}) {
  const outline = useTrackOutline(circuit || undefined)
  if (!outline || !outline.points?.length || !outline.corners?.length) return null

  // Resolve the corner: prefer exact number match, else label contains.
  const numOf = (label: string) => Number(label.match(/\d+/)?.[0])
  const match =
    (cornerNumber != null && outline.corners.find((c) => numOf(c.label) === cornerNumber)) ||
    (cornerLabel && outline.corners.find((c) => c.label.toLowerCase() === cornerLabel.toLowerCase())) ||
    null
  if (!match) return null

  const shortLabel = cornerNumber != null ? `T${cornerNumber}` : match.label

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-raised p-3">
      <div className="w-24 shrink-0">
        <TrackMap
          outline={outline}
          variant="mini"
          highlights={[{ f0: Math.max(0, match.f - 0.02), f1: Math.min(1, match.f + 0.02), color, label: "" }]}
          markers={[{ f: match.f, color, label: "", r: 30 }]}
        />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] text-section-label uppercase tracking-[0.16em]">Corner · on track</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{match.label}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{shortLabel} · real {outline.circuit} outline</p>
      </div>
    </div>
  )
}
