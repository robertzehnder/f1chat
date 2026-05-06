"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface TimelineChartProps {
  chart: ChartSpec
  className?: string
}

const kindLabels: Record<string, string> = {
  track_limits: "Track Limits",
  forcing_off: "Forcing Off",
  unsafe_release: "Unsafe Release",
  speeding: "Speeding",
  collision: "Collision"
}

export function TimelineChart({ chart, className }: TimelineChartProps) {
  if (!chart.events) return null

  return (
    <div className={cn("w-full space-y-3", className)}>
      {chart.events.map((event, index) => (
        <div 
          key={index}
          className="flex items-start gap-4 p-3 rounded-lg bg-secondary/30 border border-border/50"
        >
          {/* Lap marker */}
          <div className="flex flex-col items-center">
            <div 
              className="size-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: event.team_color }}
            >
              {event.lap}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1">LAP</span>
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-foreground">{event.driver}</span>
              <span 
                className="text-[10px] px-2 py-0.5 rounded-full bg-[#E10600]/10 text-[#E10600] font-medium uppercase tracking-wide"
              >
                {kindLabels[event.kind] || event.kind}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {event.message}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
