"use client"

import { cn } from "@/lib/utils"

interface StatHighlightProps {
  value: string | number
  label: string
  sublabel?: string
  variant?: "default" | "positive" | "negative" | "accent"
  size?: "sm" | "md" | "lg"
  className?: string
}

export function StatHighlight({ 
  value, 
  label, 
  sublabel,
  variant = "default",
  size = "md",
  className 
}: StatHighlightProps) {
  const variantStyles = {
    default: "text-foreground",
    positive: "text-emerald-500",
    negative: "text-red-500",
    accent: "text-[#E10600]"
  }
  
  const sizeStyles = {
    sm: "text-2xl",
    md: "text-4xl",
    lg: "text-5xl"
  }
  
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <span className={cn(
        "font-bold font-mono tracking-tight",
        sizeStyles[size],
        variantStyles[variant]
      )}>
        {value}
      </span>
      <span className="text-sm font-medium text-muted-foreground mt-1">{label}</span>
      {sublabel && (
        <span className="text-xs text-muted-foreground/70">{sublabel}</span>
      )}
    </div>
  )
}

interface StatGridProps {
  children: React.ReactNode
  columns?: 2 | 3 | 4
  className?: string
}

export function StatGrid({ children, columns = 3, className }: StatGridProps) {
  const colClasses = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4"
  }
  
  return (
    <div className={cn(
      "grid gap-4 py-4",
      colClasses[columns],
      className
    )}>
      {children}
    </div>
  )
}
