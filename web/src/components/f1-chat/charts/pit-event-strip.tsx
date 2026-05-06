"use client"

interface PitEventStripProps {
  chart: {
    type: "pit_event_strip"
    phases: Array<{
      label: string
      duration_sec: number
      color: string
    }>
    post_cycle?: {
      before_position: number
      after_position: number
      recovered_by_lap?: number
    }
  }
}

export function PitEventStrip({ chart }: PitEventStripProps) {
  const { phases, post_cycle } = chart
  const totalDuration = phases.reduce((sum, p) => sum + p.duration_sec, 0)

  return (
    <div className="space-y-4">
      {/* Strip visualization */}
      <div className="flex rounded-lg overflow-hidden h-12">
        {phases.map((phase, idx) => {
          const widthPct = (phase.duration_sec / totalDuration) * 100
          return (
            <div
              key={idx}
              className="flex items-center justify-center relative"
              style={{ 
                width: `${widthPct}%`,
                backgroundColor: phase.color,
                minWidth: '60px'
              }}
            >
              <span className="text-[10px] font-medium text-black/80 text-center px-1 truncate">
                {phase.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Duration labels */}
      <div className="flex">
        {phases.map((phase, idx) => {
          const widthPct = (phase.duration_sec / totalDuration) * 100
          return (
            <div
              key={idx}
              className="text-center"
              style={{ width: `${widthPct}%`, minWidth: '60px' }}
            >
              <span className="text-xs text-muted-foreground">
                {phase.duration_sec.toFixed(1)}s
              </span>
            </div>
          )
        })}
      </div>

      {/* Post-cycle outcome */}
      {post_cycle && (
        <div className="flex items-center justify-center gap-6 pt-2 border-t border-border/50">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">P{post_cycle.before_position}</p>
            <p className="text-[10px] text-muted-foreground">Before</p>
          </div>
          <div className="text-2xl text-muted-foreground">→</div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">P{post_cycle.after_position}</p>
            <p className="text-[10px] text-muted-foreground">After</p>
          </div>
          {post_cycle.recovered_by_lap && (
            <>
              <div className="text-2xl text-muted-foreground">→</div>
              <div className="text-center">
                <p className="text-lg font-bold text-[#22C55E]">P{post_cycle.before_position}</p>
                <p className="text-[10px] text-muted-foreground">Lap {post_cycle.recovered_by_lap}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
