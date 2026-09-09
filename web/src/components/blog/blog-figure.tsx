"use client"

import { ChartRenderer } from "@/components/f1-chat/charts"
import type { PostFigure } from "@/lib/blog/posts"

/** One article figure: the chart through the app's own renderer, its
 *  verified caption, and the data footer. Self-contained spec — nothing
 *  is fetched at render time. */
export function BlogFigure({ figure, index, bare = false }: { figure: PostFigure; index?: number; bare?: boolean }) {
  return (
    <figure className={bare ? "space-y-3" : "my-8 space-y-3"} data-figure={figure.name} role="img" aria-label={figure.alt}>
      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <ChartRenderer chart={figure.chart} />
      </div>
      <figcaption className="text-[13px] leading-relaxed text-muted-foreground">
        {index != null && <span className="font-semibold text-foreground">Figure {index}. </span>}
        {figure.caption}
        <span className="mt-1 block text-[11px] text-muted-foreground/80">
          Data: OpenF1{figure.verified ? " · every number on this figure resolves to the race evidence packet" : ""}
        </span>
      </figcaption>
    </figure>
  )
}
