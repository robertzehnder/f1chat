"use client"

interface VerdictCardProps {
  verdict: {
    label: "YES" | "NO"
    color?: string
    summary: string
  }
}

export function VerdictCard({ verdict }: VerdictCardProps) {
  const isYes = verdict.label === "YES"
  
  return (
    <div className="flex flex-col items-center py-6">
      <span 
        className="text-5xl md:text-6xl font-black tracking-tight"
        style={{ color: verdict.color || (isYes ? "#22C55E" : "#EF4444") }}
      >
        {verdict.label}
      </span>
      <p className="text-sm text-muted-foreground mt-3 text-center max-w-md">
        {verdict.summary}
      </p>
    </div>
  )
}
