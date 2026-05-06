"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from "recharts"
import { getTeamColor } from "@/lib/f1-team-colors"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

interface SpeedData {
  driver: string
  team: string
  entry: number
  apex: number
  exit: number
}

interface SpeedComparisonProps {
  data: SpeedData[]
  corner: string
  className?: string
}

export function SpeedComparison({ data, corner, className }: SpeedComparisonProps) {
  const chartConfig = data.reduce((acc, item) => {
    acc[item.driver] = {
      label: item.driver,
      color: getTeamColor(item.team),
    }
    return acc
  }, {} as Record<string, { label: string; color: string }>)

  const metrics = ["entry", "apex", "exit"] as const
  const metricLabels = {
    entry: "Entry Speed",
    apex: "Apex Speed",
    exit: "Exit Speed"
  }

  return (
    <div className={className}>
      <h4 className="text-sm font-medium text-muted-foreground mb-4">{corner}</h4>
      <div className="grid grid-cols-3 gap-4">
        {metrics.map((metric) => {
          const chartData = data.map(d => ({
            name: d.driver.split(" ").pop(),
            value: d[metric],
            driver: d.driver,
            team: d.team
          }))
          
          return (
            <div key={metric} className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">{metricLabels[metric]}</p>
              <ChartContainer config={chartConfig} className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 40 }}>
                    <XAxis type="number" hide domain={['dataMin - 10', 'dataMax + 5']} />
                    <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 11 }} />
                    <ChartTooltip 
                      content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)} km/h`} />}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={getTeamColor(entry.team)} />
                      ))}
                      <LabelList 
                        dataKey="value" 
                        position="right" 
                        formatter={(v: number) => v.toFixed(1)}
                        className="fill-muted-foreground text-[10px]"
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface MultiCornerComparisonProps {
  data: {
    corner: string
    cornerNumber: number
    drivers: SpeedData[]
  }[]
  className?: string
}

export function MultiCornerComparison({ data, className }: MultiCornerComparisonProps) {
  // Transform data for grouped bar chart
  const chartData = data.map(corner => {
    const result: Record<string, string | number> = {
      corner: `T${corner.cornerNumber}`,
      fullName: corner.corner
    }
    corner.drivers.forEach(driver => {
      const lastName = driver.driver.split(" ").pop() || driver.driver
      result[`${lastName}_entry`] = driver.entry
      result[`${lastName}_apex`] = driver.apex
      result[`${lastName}_exit`] = driver.exit
      result[`${lastName}_team`] = driver.team
    })
    return result
  })

  const drivers = data[0]?.drivers || []
  const chartConfig = drivers.reduce((acc, driver) => {
    const lastName = driver.driver.split(" ").pop() || driver.driver
    acc[lastName] = {
      label: driver.driver,
      color: getTeamColor(driver.team),
    }
    return acc
  }, {} as Record<string, { label: string; color: string }>)

  return (
    <div className={className}>
      <ChartContainer config={chartConfig} className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <XAxis 
              dataKey="corner" 
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 20', 'dataMax + 10']}
              tickFormatter={(v) => `${v}`}
            />
            <ChartTooltip 
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const cornerData = chartData.find(d => d.corner === label)
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                    <p className="font-medium text-sm mb-2">{cornerData?.fullName}</p>
                    {payload.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <div 
                          className="size-2 rounded-full" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">{entry.name}:</span>
                        <span className="font-mono">{Number(entry.value).toFixed(1)} km/h</span>
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            {drivers.map((driver) => {
              const lastName = driver.driver.split(" ").pop() || driver.driver
              return (
                <Bar 
                  key={lastName}
                  dataKey={`${lastName}_apex`} 
                  fill={getTeamColor(driver.team)}
                  radius={[4, 4, 0, 0]}
                  name={lastName}
                />
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
      <div className="flex justify-center gap-6 mt-2">
        {drivers.map((driver) => (
          <div key={driver.driver} className="flex items-center gap-2 text-xs">
            <div 
              className="size-3 rounded-sm" 
              style={{ backgroundColor: getTeamColor(driver.team) }}
            />
            <span className="text-muted-foreground">{driver.driver}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
