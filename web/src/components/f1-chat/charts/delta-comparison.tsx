"use client"

import type { ChartSpec } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface DeltaComparisonProps {
  chart: ChartSpec
  className?: string
}

/**
 * A clean visualization for showing deltas between two entities (e.g., drivers)
 * When one series is always 0 (baseline), only show the other's delta values
 */
export function DeltaComparison({ chart, className }: DeltaComparisonProps) {
  if (!chart.x_axis || !chart.series || chart.series.length < 2) return null

  // Find the baseline series (all zeros or near-zero) and the comparison series
  const baselineSeries = chart.series.find(s => 
    s.values.every(v => Math.abs(v) < 0.001)
  )
  const comparisonSeries = chart.series.find(s => s !== baselineSeries) || chart.series[1]
  const baselineName = baselineSeries?.name || chart.series[0].name

  // Get max value for scaling bars
  const maxDelta = Math.max(...comparisonSeries.values.map(Math.abs), 0.01)

  return (
    <div className={cn("w-full space-y-3", className)}>
      {/* Header showing who is being compared */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Delta to {baselineName}</span>
        <div className="flex items-center gap-2">
          <div 
            className="size-2.5 rounded-full"
            style={{ backgroundColor: comparisonSeries.color }}
          />
          <span>{comparisonSeries.name}</span>
        </div>
      </div>

      {/* Delta rows */}
      <div className="space-y-2">
        {chart.x_axis.map((label, index) => {
          const delta = comparisonSeries.values[index]
          const isPositive = delta > 0
          const barWidth = Math.max((Math.abs(delta) / maxDelta) * 100, 5)
          
          return (
            <div key={label} className="flex items-center gap-3">
              {/* Turn label */}
              <span className="w-10 text-sm font-medium text-foreground shrink-0">
                {label}
              </span>
              
              {/* Bar container */}
              <div className="flex-1 h-8 bg-secondary/30 rounded-md overflow-hidden relative">
                <div 
                  className={cn(
                    "h-full rounded-md transition-all duration-300 flex items-center",
                    isPositive ? "justify-end pr-2" : "justify-start pl-2"
                  )}
                  style={{ 
                    width: `${barWidth}%`,
                    backgroundColor: comparisonSeries.color,
                    opacity: 0.8
                  }}
                >
                  {barWidth > 30 && (
                    <span className="text-xs font-semibold text-white">
                      {isPositive ? '+' : ''}{delta.toFixed(2)}s
                    </span>
                  )}
                </div>
                {barWidth <= 30 && (
                  <span 
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-foreground"
                  >
                    {isPositive ? '+' : ''}{delta.toFixed(2)}s
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div className="pt-2 border-t border-border/30 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Average deficit</span>
        <span className="font-medium text-foreground">
          +{(comparisonSeries.values.reduce((a, b) => a + b, 0) / comparisonSeries.values.length).toFixed(2)}s
        </span>
      </div>

      {chart.y_label && (
        <p className="text-[10px] text-muted-foreground text-center">{chart.y_label}</p>
      )}
    </div>
  )
}
