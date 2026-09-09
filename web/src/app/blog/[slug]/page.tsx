import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPost } from "@/lib/blog/posts";
import { PostBody } from "@/components/blog/post-body";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = readPost(slug);
  if (!post) return { title: "Not found" };
  const heroPng = `/blog/${slug}/${post.hero_figure}.png`;
  const hasHero = existsSync(join(process.cwd(), "public", heroPng));
  return {
    title: `${post.title} — F1 Chat`,
    description: post.dek,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: { title: post.title, description: post.dek, type: "article", publishedTime: post.published_at, ...(hasHero ? { images: [{ url: heroPng, width: 1200, height: 675 }] } : {}) },
    twitter: { card: hasHero ? "summary_large_image" : "summary", title: post.title, description: post.dek, ...(hasHero ? { images: [heroPng] } : {}) }
  };
}

export default async function BlogPost({ params }: Params) {
  const { slug } = await params;
  const post = readPost(slug);
  if (!post) notFound();
  const date = new Date(post.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <nav className="mb-8 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <Link href="/blog" className="hover:underline">F1 Chat · Analysis</Link>
      </nav>
      <article>
        <header className="mb-8">
          <h1 className="text-[2rem] font-semibold leading-tight sm:text-[2.4rem]">{post.title}</h1>
          <p className="mt-3 text-lg text-muted-foreground">{post.dek}</p>
          <p className="mt-4 text-xs text-muted-foreground/80">{post.author} · {date} · Data: OpenF1</p>
        </header>
        <PostBody post={post} />
        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground/80">
          <p>Written from the race evidence packet (session {post.session_key}). Figures are self-contained and verified against the packet; the text is the verified article of record.</p>
          <p className="mt-2"><Link href="/" className="hover:underline">Ask F1 Chat about this race →</Link></p>
        </footer>
      </article>
    </main>
  );
}
