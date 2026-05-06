"use client"

interface MinisectorStripProps {
  chart: {
    type: "track_heatmap"
    circuit: string
    sector?: number
    segments: Array<{
      minisector_index: number
      name: string
      leader: string
      color: string
      delta_ms: number
    }>
  }
}

export function MinisectorStrip({ chart }: MinisectorStripProps) {
  const { circuit, sector, segments } = chart

  // Group consecutive segments by leader for cleaner display
  const groupedSegments: Array<{
    leader: string
    color: string
    segments: typeof segments
    totalDelta: number
  }> = []

  let currentGroup: typeof groupedSegments[0] | null = null
  
  for (const seg of segments) {
    if (!currentGroup || currentGroup.leader !== seg.leader) {
      if (currentGroup) groupedSegments.push(currentGroup)
      currentGroup = {
        leader: seg.leader,
        color: seg.color,
        segments: [seg],
        totalDelta: seg.delta_ms
      }
    } else {
      currentGroup.segments.push(seg)
      currentGroup.totalDelta += seg.delta_ms
    }
  }
  if (currentGroup) groupedSegments.push(currentGroup)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground">
          {circuit} {sector ? `Sector ${sector}` : ""} — {segments.length} minisectors
        </p>
      </div>

      {/* Vertical strip visualization */}
      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div 
            key={idx}
            className="flex items-center gap-3"
          >
            <div 
              className="w-4 h-4 rounded-sm shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-xs text-muted-foreground w-28 truncate">
              {seg.name}
            </span>
            <div className="flex-1 h-2 bg-secondary/30 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full"
                style={{ 
                  backgroundColor: seg.color,
                  width: `${Math.min(100, (seg.delta_ms / 30) * 100)}%`
                }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-16 text-right">
              +{seg.delta_ms}ms
            </span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex justify-center gap-6 pt-2 border-t border-border/50">
        {Object.entries(
          segments.reduce((acc, seg) => {
            acc[seg.leader] = (acc[seg.leader] || 0) + 1
            return acc
          }, {} as Record<string, number>)
        ).map(([leader, count]) => {
          const color = segments.find(s => s.leader === leader)?.color
          return (
            <div key={leader} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-muted-foreground">
                {leader}: {count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
