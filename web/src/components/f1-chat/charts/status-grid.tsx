"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface StatusGridChartProps {
  chart: ChartSpec
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  full: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  partial: { bg: "bg-amber-500/20", text: "text-amber-400" },
  missing: { bg: "bg-red-500/20", text: "text-red-400" }
}

export function StatusGridChart({ chart }: StatusGridChartProps) {
  if (!chart.rows) return null

  // Get all column keys except 'label' and 'session_key'
  const columns = Object.keys(chart.rows[0] || {}).filter(
    k => k !== "label" && k !== "session_key"
  )

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Session</th>
            {columns.map((col) => (
              <th key={col} className="text-center py-2 px-3 font-medium text-muted-foreground capitalize">
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, idx) => (
            <tr key={idx} className="border-b border-border/30">
              <td className="py-2 px-3 text-foreground font-medium">{row.label}</td>
              {columns.map((col) => {
                const status = row[col] as string
                const colors = STATUS_COLORS[status] || STATUS_COLORS.missing
                return (
                  <td key={col} className="py-2 px-3 text-center">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded text-xs font-medium",
                      colors.bg,
                      colors.text
                    )}>
                      {status}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      
      {/* Legend */}
      <div className="flex gap-4 mt-4 justify-center">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={cn("w-3 h-3 rounded", colors.bg)} />
            <span className="text-xs text-muted-foreground capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
