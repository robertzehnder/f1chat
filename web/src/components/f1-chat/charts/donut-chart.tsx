"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

interface DonutChartProps {
  chart: {
    type: "donut"
    center_label: string
    slices: Array<{
      label: string
      value: number
      color: string
    }>
  }
}

export function DonutChart({ chart }: DonutChartProps) {
  const { slices, center_label } = chart
  const total = slices.reduce((sum, s) => sum + s.value, 0)

  return (
    <div>
      <div className="relative h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            nameKey="label"
          >
            {slices.map((slice, index) => (
              <Cell key={index} fill={slice.color} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload
                const pct = ((data.value / total) * 100).toFixed(0)
                return (
                  <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                    <p className="text-xs font-medium text-foreground">{data.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {data.value} ({pct}%)
                    </p>
                  </div>
                )
              }
              return null
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          {center_label.split("\n").map((line, i) => (
            <p 
              key={i} 
              className={i === 0 ? "text-2xl font-bold text-foreground" : "text-xs text-muted-foreground"}
            >
              {line}
            </p>
          ))}
        </div>
      </div>

      </div>

      {/* Readout — in-place share labels (value + %) per slice, deck-style */}
      <div className="mt-4 flex flex-col gap-1.5">
        {[...slices].sort((a, b) => b.value - a.value).map((slice, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
            <span className="text-foreground/85 flex-1 truncate">{slice.label}</span>
            <span className="font-mono tabular-nums text-foreground/70">{slice.value}</span>
            <span className="font-mono tabular-nums text-muted-foreground w-9 text-right">
              {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
