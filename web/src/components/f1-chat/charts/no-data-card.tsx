"use client"

import { AlertCircle } from "lucide-react"

interface NoDataCardProps {
  what_we_have?: string[]
}

export function NoDataCard({ what_we_have }: NoDataCardProps) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 text-semantic-warning">
        <AlertCircle className="size-4 shrink-0" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">The metric can&apos;t be computed — here&apos;s why, honestly</span>
      </div>

      {what_we_have && what_we_have.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-surface-raised p-4">
          <p className="font-mono text-[10px] md:text-[10.5px] text-section-label mb-2.5 uppercase tracking-[0.16em]">
            What we can answer instead
          </p>
          <ul className="space-y-1.5">
            {what_we_have.map((item, idx) => (
              <li key={idx} className="text-[13px] md:text-sm text-foreground/85 flex items-start gap-2.5">
                <span className="text-semantic-positive mt-px font-semibold shrink-0">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
