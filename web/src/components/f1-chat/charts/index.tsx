"use client"

import type { ChartSpec, Metric } from "@/lib/chart-types"
import { GroupedBarChart } from "./grouped-bar-chart"
import { LineChart } from "./line-chart"
import { HorizontalBarChart } from "./horizontal-bar-chart"
import { DivergingBarChart } from "./diverging-bar-chart"
import { TimelineChart } from "./timeline-chart"
import { RadarChart } from "./radar-chart"
import { ScatterChart } from "./scatter-chart"
import { MetricGrid } from "./metric-grid"
import { StackedHorizontalBarChart } from "./stacked-horizontal-bar"
import { LineDualAxisChart } from "./line-dual-axis-chart"
import { StatusGridChart } from "./status-grid"
import { HeroScalar } from "./hero-scalar"
import { VerdictCard } from "./verdict-card"
import { StintGantt } from "./stint-gantt"
import { DonutChart } from "./donut-chart"
import { PitEventStrip } from "./pit-event-strip"
import { MinisectorStrip } from "./minisector-strip"
import { NoDataCard } from "./no-data-card"
import { LineWithStintMarkers } from "./line-with-stint-markers"
import { CompositeCard } from "./composite-card"
import { DeltaComparison } from "./delta-comparison"

interface ChartRendererProps {
  chart: ChartSpec
  className?: string
}

// Check if a grouped_bar chart is actually a delta comparison (one series is all zeros)
function isDeltaComparison(chart: ChartSpec): boolean {
  if (chart.type !== "grouped_bar" || !chart.series || chart.series.length !== 2) return false
  // Check if one series is all zeros (baseline)
  return chart.series.some(s => s.values.every(v => Math.abs(v) < 0.001))
}

export function ChartRenderer({ chart, className }: ChartRendererProps) {
  switch (chart.type) {
    case "grouped_bar":
      // Use DeltaComparison for baseline comparisons (e.g., delta to leader)
      if (isDeltaComparison(chart)) {
        return <DeltaComparison chart={chart} className={className} />
      }
      return <GroupedBarChart chart={chart} className={className} />
    case "line":
      return <LineChart chart={chart} className={className} />
    case "horizontal_bar":
      return <HorizontalBarChart chart={chart} className={className} />
    case "horizontal_bar_diverging":
      return <DivergingBarChart chart={chart} className={className} />
    case "timeline":
      return <TimelineChart chart={chart} className={className} />
    case "radar":
      return <RadarChart chart={chart} className={className} />
    case "scatter_with_regression":
      return <ScatterChart chart={chart} className={className} />
    case "stacked_horizontal_bar":
      return <StackedHorizontalBarChart chart={chart} />
    case "line_dual_axis":
      return <LineDualAxisChart chart={chart} />
    case "status_grid":
      return <StatusGridChart chart={chart} />
    case "stint_gantt":
      return <StintGantt chart={chart as any} />
    case "donut":
      return <DonutChart chart={chart as any} />
    case "pit_event_strip":
      return <PitEventStrip chart={chart as any} />
    case "track_heatmap":
      return <MinisectorStrip chart={chart as any} />
    case "line_with_stint_markers":
      return <LineWithStintMarkers chart={chart as any} />
    case "event_timeline":
      return <TimelineChart chart={chart} className={className} />
    default:
      return (
        <div className="text-sm text-muted-foreground p-4 text-center">
          Chart type &quot;{chart.type}&quot; not yet implemented
        </div>
      )
  }
}

interface MetricGridRendererProps {
  metrics: Metric[]
  className?: string
}

export function MetricGridRenderer({ metrics, className }: MetricGridRendererProps) {
  return <MetricGrid metrics={metrics} className={className} />
}

export { GroupedBarChart } from "./grouped-bar-chart"
export { LineChart } from "./line-chart"
export { HorizontalBarChart } from "./horizontal-bar-chart"
export { DivergingBarChart } from "./diverging-bar-chart"
export { TimelineChart } from "./timeline-chart"
export { RadarChart } from "./radar-chart"
export { ScatterChart } from "./scatter-chart"
export { MetricGrid } from "./metric-grid"
export { StackedHorizontalBarChart } from "./stacked-horizontal-bar"
export { LineDualAxisChart } from "./line-dual-axis-chart"
export { StatusGridChart } from "./status-grid"
export { HeroScalar } from "./hero-scalar"
export { VerdictCard } from "./verdict-card"
export { StintGantt } from "./stint-gantt"
export { DonutChart } from "./donut-chart"
export { PitEventStrip } from "./pit-event-strip"
export { MinisectorStrip } from "./minisector-strip"
export { NoDataCard } from "./no-data-card"
export { LineWithStintMarkers } from "./line-with-stint-markers"
export { CompositeCard } from "./composite-card"
export { DeltaComparison } from "./delta-comparison"
