"use client"

import { cn } from "@/lib/utils"

interface SuggestionChipsProps {
  suggestions: string[]
  onSelect: (suggestion: string) => void
  className?: string
}

export function SuggestionChips({ suggestions, onSelect, className }: SuggestionChipsProps) {
  if (!suggestions.length) return null
  
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-full transition-colors border border-border/50 hover:border-border"
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}

interface FollowUpChipsProps {
  questions: string[]
  onSelect: (question: string) => void
}

export function FollowUpChips({ questions, onSelect }: FollowUpChipsProps) {
  if (!questions.length) return null
  
  return (
    <div className="pt-3 md:pt-4 border-t border-border/30">
      <p className="text-[10px] text-muted-foreground mb-2 md:mb-3 uppercase tracking-wide font-medium">Explore Further</p>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
        {questions.map((question, index) => (
          <button
            key={index}
            onClick={() => onSelect(question)}
            className="px-2.5 md:px-3 py-1 md:py-1.5 text-[11px] md:text-xs bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg transition-all border border-transparent hover:border-border/50"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}
