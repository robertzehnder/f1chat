import Link from "next/link";
import { listPosts } from "@/lib/blog/posts";

export const metadata = { title: "F1 Chat — Analysis", description: "Race analysis written from the timing record, with verified figures." };

export default function BlogIndex() {
  const posts = listPosts();
  return (
    <main className="mx-auto max-w-[720px] px-5 py-12">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">F1 Chat</p>
        <h1 className="mt-2 text-3xl font-semibold">Analysis</h1>
        <p className="mt-2 text-muted-foreground">Race analysis written from the timing record. Every figure resolves to the race evidence packet.</p>
      </header>
      <ul className="space-y-8">
        {posts.map((p) => (
          <li key={p.slug}>
            <Link href={`/blog/${p.slug}`} className="group block">
              <h2 className="text-xl font-semibold group-hover:underline">{p.title}</h2>
              <p className="mt-1 text-muted-foreground">{p.dek}</p>
              <p className="mt-1 text-xs text-muted-foreground/80">{new Date(p.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
            </Link>
          </li>
        ))}
        {posts.length === 0 && <li className="text-muted-foreground">No posts yet.</li>}
      </ul>
    </main>
  );
}
