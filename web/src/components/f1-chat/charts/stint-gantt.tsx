"use client"

interface StintGanttProps {
  chart: {
    type: "stint_gantt"
    y_axis: string[]
    total_laps: number
    stints: Array<{
      driver: string
      start: number
      end: number
      compound: "hard" | "medium" | "soft" | "inter" | "wet"
      lap_times_avg?: number
    }>
    compound_legend: Record<string, string>
  }
}

const COMPOUND_COLORS: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  wet: "#3B82F6"
}

export function StintGantt({ chart }: StintGanttProps) {
  const { y_axis, total_laps, stints } = chart

  return (
    <div className="space-y-6">
      {/* Gantt rows */}
      <div className="space-y-3">
        {y_axis.map((driver) => {
          const driverStints = stints.filter(s => s.driver === driver)
          return (
            <div key={driver} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">
                {driver}
              </span>
              <div className="flex-1 h-8 bg-secondary/30 rounded relative overflow-hidden">
                {driverStints.map((stint, idx) => {
                  const startPct = ((stint.start - 1) / total_laps) * 100
                  const widthPct = ((stint.end - stint.start + 1) / total_laps) * 100
                  const color = COMPOUND_COLORS[stint.compound] || "#9CA3AF"
                  
                  return (
                    <div
                      key={idx}
                      className="absolute top-0 h-full flex items-center justify-center"
                      style={{
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: color
                      }}
                    >
                      <span className="text-[10px] font-medium text-black/70 truncate px-1">
                        {stint.compound.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Lap axis */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Lap 1</span>
          <span>Lap {Math.floor(total_laps / 2)}</span>
          <span>Lap {total_laps}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center">
        {Object.entries(COMPOUND_COLORS).map(([compound, color]) => (
          <div key={compound} className="flex items-center gap-1.5">
            <div 
              className="w-3 h-3 rounded-sm" 
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-muted-foreground capitalize">
              {compound}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
