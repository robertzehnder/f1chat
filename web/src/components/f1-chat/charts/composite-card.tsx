"use client"

import { LineChart } from "./line-chart"
import { MetricGrid } from "./metric-grid"

interface CompositeCardProps {
  composite: Array<{
    type: string
    title?: string
    // Line chart props
    x_label?: string
    y_label?: string
    series?: Array<{
      name: string
      color: string
      values: number[]
    }>
    vertical_markers?: Array<{
      x: number
      label: string
    }>
    // Metric grid props
    metrics?: Array<{
      label: string
      value: string
      unit?: string
      emphasis?: boolean
    }>
  }>
}

export function CompositeCard({ composite }: CompositeCardProps) {
  return (
    <div className="space-y-5">
      {composite.map((section, idx) => (
        <div key={idx} className={idx > 0 ? "space-y-2 border-t border-border/30 pt-4" : "space-y-2"}>
          {section.title && (
            <p className="font-mono text-[10.5px] text-section-label uppercase tracking-[0.16em]">
              {section.title}
            </p>
          )}

          {section.type === "line" && section.series && (
            <LineChart 
              chart={{
                type: "line",
                x_label: section.x_label || "Lap",
                y_label: section.y_label || "Value",
                series: section.series,
                vertical_markers: section.vertical_markers
              }}
            />
          )}

          {section.type === "metric_grid_3" && section.metrics && (
            <MetricGrid metrics={section.metrics} />
          )}
        </div>
      ))}
    </div>
  )
}
