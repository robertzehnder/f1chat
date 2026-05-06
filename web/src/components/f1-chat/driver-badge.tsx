import { getTeamColor, getTeamForDriver } from "@/lib/f1-team-colors"

interface DriverBadgeProps {
  name: string
  number?: number
  team?: string
  size?: "sm" | "md" | "lg"
}

export function DriverBadge({ name, number, team, size = "md" }: DriverBadgeProps) {
  const teamName = team || getTeamForDriver(name)
  const teamColor = getTeamColor(teamName)
  
  const sizeClasses = {
    sm: "text-xs gap-1.5",
    md: "text-sm gap-2",
    lg: "text-base gap-2.5"
  }
  
  const badgeSizes = {
    sm: "size-6 text-[10px]",
    md: "size-8 text-xs",
    lg: "size-10 text-sm"
  }
  
  return (
    <div className={`flex items-center ${sizeClasses[size]}`}>
      {number && (
        <div 
          className={`${badgeSizes[size]} rounded-md flex items-center justify-center font-bold text-white`}
          style={{ backgroundColor: teamColor }}
        >
          {number}
        </div>
      )}
      <div className="flex flex-col">
        <span className="font-semibold text-foreground">{name}</span>
        <span className="text-muted-foreground text-xs">{teamName}</span>
      </div>
    </div>
  )
}

interface DriverChipProps {
  name: string
  team?: string
}

export function DriverChip({ name, team }: DriverChipProps) {
  const teamName = team || getTeamForDriver(name)
  const teamColor = getTeamColor(teamName)
  
  return (
    <span 
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
      style={{ backgroundColor: teamColor }}
    >
      {name}
    </span>
  )
}
