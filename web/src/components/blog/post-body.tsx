import type { ReactNode } from "react"
import type { PostDoc } from "@/lib/blog/posts"
import { BlogFigure } from "./blog-figure"

/** Minimal, sanitising markdown: paragraphs, one heading level, **bold**,
 *  *italic*, `[text](https://…)` links to https URLs only (source
 *  attributions), and `{{fig:name}}` placeholder lines. Nothing else is
 *  interpreted — no raw HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const link = tok.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/)
    if (link) out.push(<a key={`${key}-a${i++}`} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">{link[1]}</a>)
    else if (tok.startsWith("**")) out.push(<strong key={`${key}-b${i++}`}>{tok.slice(2, -2)}</strong>)
    else out.push(<em key={`${key}-i${i++}`}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function PostBody({ post }: { post: PostDoc }) {
  const blocks = post.body_md.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  let figN = 0
  return (
    <div className="space-y-5 text-[17px] leading-[1.7] text-foreground/95">
      {blocks.map((block, i) => {
        const fig = block.match(/^\{\{fig:([a-z0-9_-]+)\}\}$/i)
        if (fig) {
          const f = post.figures[fig[1]]
          if (!f) return <p key={i} className="text-sm text-semantic-negative">[missing figure: {fig[1]}]</p>
          figN += 1
          return <BlogFigure key={i} figure={f} index={figN} />
        }
        if (block.startsWith("# ")) return null // title is rendered by the page
        if (block.startsWith("## ")) return <h2 key={i} className="mt-8 text-xl font-semibold">{inline(block.slice(3), `h${i}`)}</h2>
        return <p key={i}>{inline(block, `p${i}`)}</p>
      })}
    </div>
  )
}
