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
    gantt_stops?: Array<{ driver: string; lap: number; label: string }>
    racing_state?: import("@/lib/chart-types").RacingStateLayer
    chart_note?: string
  }
}

const STOP_COLORS: Record<string, string> = { VSC: "#F59E0B", SC: "#F59E0B", red: "#EF4444", green: "#9CA3AF" }
const KIND_STYLE: Record<string, React.CSSProperties> = {
  red: { background: "repeating-linear-gradient(45deg, rgba(239,68,68,0.55) 0 2px, rgba(239,68,68,0.12) 2px 6px)" },
  sc: { backgroundColor: "rgba(245,158,11,0.28)" },
  vsc: { backgroundColor: "rgba(245,158,11,0.16)", borderLeft: "1.5px dashed rgba(245,158,11,0.9)", borderRight: "1.5px dashed rgba(245,158,11,0.9)" }
}

const COMPOUND_COLORS: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  wet: "#3B82F6"
}

export function StintGantt({ chart }: StintGanttProps) {
  const { y_axis, total_laps, stints, gantt_stops, racing_state, chart_note } = chart
  const periods = racing_state && (racing_state.source === "available" || racing_state.source === "incomplete") ? racing_state.periods : []
  const pct = (lap: number) => ((lap - 1) / total_laps) * 100

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
              <div className="flex-1 h-8 bg-secondary/30 rounded relative overflow-visible">
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
                {periods.map((p, i) => (
                  <div
                    key={`rs-${i}`}
                    className="absolute top-0 h-full pointer-events-none"
                    title={`${p.kind.toUpperCase()} L${p.from_lap}${p.to_lap != null && p.to_lap !== p.from_lap ? `–${p.to_lap}` : ""}`}
                    style={{ left: `${pct(p.from_lap)}%`, width: `${(((p.to_lap ?? total_laps) - p.from_lap + 1) / total_laps) * 100}%`, ...KIND_STYLE[p.kind] }}
                  />
                ))}
                {(gantt_stops ?? []).filter((st) => st.driver === driver).map((st, i) => (
                  <div
                    key={`stop-${i}`}
                    className="absolute -top-1.5 flex flex-col items-center"
                    title={`${driver} stop · lap ${st.lap} · ${st.label}`}
                    style={{ left: `${pct(st.lap) + (100 / total_laps) / 2}%`, transform: "translateX(-50%)" }}
                  >
                    <span style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${STOP_COLORS[st.label] ?? "#9CA3AF"}` }} />
                  </div>
                ))}
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

      {chart_note && <p className="text-[11px] text-muted-foreground text-center">{chart_note}</p>}
      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center">
        {periods.some((p) => p.kind === "red") && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={KIND_STYLE.red} /><span className="text-xs text-muted-foreground">red flag</span></div>}
        {periods.some((p) => p.kind === "sc") && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={KIND_STYLE.sc} /><span className="text-xs text-muted-foreground">safety car</span></div>}
        {periods.some((p) => p.kind === "vsc") && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={KIND_STYLE.vsc} /><span className="text-xs text-muted-foreground">virtual safety car</span></div>}
        {(gantt_stops ?? []).length > 0 && (
          <>
            <div className="flex items-center gap-1.5"><span style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${STOP_COLORS.VSC}` }} /><span className="text-xs text-muted-foreground">stop under VSC / SC</span></div>
            <div className="flex items-center gap-1.5"><span style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${STOP_COLORS.red}` }} /><span className="text-xs text-muted-foreground">tyre change during the red flag</span></div>
            <div className="flex items-center gap-1.5"><span style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${STOP_COLORS.green}` }} /><span className="text-xs text-muted-foreground">stop at racing speed</span></div>
          </>
        )}
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
