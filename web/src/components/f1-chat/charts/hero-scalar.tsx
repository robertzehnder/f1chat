"use client"

interface HeroScalarProps {
  hero: {
    value: string
    label: string
    context?: string
  }
}

export function HeroScalar({ hero }: HeroScalarProps) {
  return (
    <div className="flex flex-col items-center py-8">
      <p className="text-6xl md:text-7xl font-bold text-foreground tracking-tight font-mono">
        {hero.value}
      </p>
      <p className="text-sm text-muted-foreground mt-2 uppercase tracking-wide">
        {hero.label}
      </p>
      {hero.context && (
        <p className="text-xs text-muted-foreground/70 mt-1">
          {hero.context}
        </p>
      )}
    </div>
  )
}
