import { notFound } from "next/navigation";
import { readPost } from "@/lib/blog/posts";
import { BlogFigure } from "@/components/blog/blog-figure";

/** Bare figure page: one figure at a fixed export width, used by
 *  scripts/analyst/export_figures.mjs (PNG for og:image and social) and as
 *  the no-JS fallback target. */
export default async function FigurePage({ params }: { params: Promise<{ slug: string; name: string }> }) {
  const { slug, name } = await params;
  const post = readPost(slug);
  const figure = post?.figures[name];
  if (!post || !figure) notFound();
  return (
    <main className="bg-background p-6" style={{ width: 1200 }}>
      <div data-export-root className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{post.title}</p>
        <BlogFigure figure={figure} bare />
      </div>
    </main>
  );
}
