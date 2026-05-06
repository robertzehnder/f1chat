"use client"

import type { Metric } from "@/lib/chart-types"
import { cn } from "@/lib/utils"

interface MetricGridProps {
  metrics: Metric[]
  className?: string
}

export function MetricGrid({ metrics, className }: MetricGridProps) {
  // On mobile (< 3 metrics): show all in a row
  // On mobile (>= 3 metrics): 2 columns
  // On desktop: up to 4 columns
  const colCount = Math.min(metrics.length, 4)
  
  return (
    <div 
      className={cn(
        "grid gap-2 md:gap-3",
        // Mobile: 2 cols if 3+ metrics, else match count
        metrics.length >= 3 ? "grid-cols-2" : `grid-cols-${Math.min(metrics.length, 2)}`,
        // Desktop: up to 4 columns
        colCount === 3 && "md:grid-cols-3",
        colCount >= 4 && "md:grid-cols-4",
        className
      )}
    >
      {metrics.map((metric, index) => (
        <div 
          key={index}
          className={cn(
            "rounded-lg p-3 md:p-4 text-center overflow-hidden",
            metric.emphasis 
              ? "bg-[#E10600]/10 border border-[#E10600]/20" 
              : "bg-secondary/50"
          )}
        >
          <p className="text-lg md:text-2xl font-bold text-foreground tracking-tight truncate">
            {metric.value}
            {metric.unit && !metric.emphasis && (
              <span className="text-xs md:text-sm font-normal text-muted-foreground ml-1">{metric.unit}</span>
            )}
          </p>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1 truncate">{metric.label}</p>
          {metric.emphasis && metric.unit && (
            <p className="text-[10px] md:text-xs text-[#E10600] mt-0.5 truncate">{metric.unit}</p>
          )}
        </div>
      ))}
    </div>
  )
}
