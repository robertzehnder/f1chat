"use client"

import { cn } from "@/lib/utils"

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    color: string
    dataKey: string
  }>
  label?: string
  formatter?: (value: number, name: string) => string
  labelFormatter?: (label: string) => string
  className?: string
}

export function ChartTooltip({ 
  active, 
  payload, 
  label, 
  formatter,
  labelFormatter,
  className 
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  const formattedLabel = labelFormatter ? labelFormatter(String(label)) : label

  return (
    <div className={cn(
      "bg-card border border-border rounded-lg px-3 py-2 shadow-lg",
      className
    )}>
      {formattedLabel && (
        <p className="text-sm font-semibold text-foreground mb-1">{formattedLabel}</p>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, index) => {
          const displayValue = formatter 
            ? formatter(entry.value, entry.name)
            : entry.value?.toFixed?.(1) ?? entry.value
          
          return (
            <div key={index} className="flex items-center gap-2 text-xs">
              <div 
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="text-foreground font-medium">{displayValue}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Simple tooltip for single-series charts
interface SimpleTooltipProps {
  active?: boolean
  payload?: Array<{
    payload: Record<string, unknown>
    value: number
    name: string
  }>
  label?: string
  valueKey?: string
  valueLabel?: string
  valueFormatter?: (value: number) => string
}

export function SimpleTooltip({
  active,
  payload,
  label,
  valueKey = 'value',
  valueLabel,
  valueFormatter
}: SimpleTooltipProps) {
  if (!active || !payload?.length) return null

  const data = payload[0]
  const value = data.value
  const displayValue = valueFormatter ? valueFormatter(value) : value?.toFixed?.(1) ?? value

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {valueLabel && <span>{valueLabel}: </span>}
        <span className="text-foreground font-medium">{displayValue}</span>
      </p>
    </div>
  )
}
