"use client"

import { AlertCircle } from "lucide-react"

interface NoDataCardProps {
  what_we_have?: string[]
}

export function NoDataCard({ what_we_have }: NoDataCardProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="size-5" />
        <span className="text-sm font-medium">Data not available in OpenF1</span>
      </div>
      
      {what_we_have && what_we_have.length > 0 && (
        <div className="bg-secondary/30 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">
            What we can show instead
          </p>
          <ul className="space-y-1">
            {what_we_have.map((item, idx) => (
              <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                <span className="text-[#22C55E] mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
