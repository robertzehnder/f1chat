/**
 * Blog posts — file-backed draft store (visuals plan S1.5-lite, 2026-09-09).
 * A post is `content/blog/<slug>.json`, written by scripts/analyst/build_post.mjs
 * from the verified article and the compiled figures. The database-backed
 * revision model with the guarded publish gate (migration 063) replaces this
 * store; the page contract (PostDoc) is the same.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ChartSpec } from "@/lib/chart-types";

export type PostFigure = {
  name: string;
  chart: ChartSpec;
  caption: string;
  alt: string;
  verified: boolean;
  provenance: Record<string, unknown>;
};

export type PostDoc = {
  slug: string;
  title: string;
  dek: string;
  published_at: string;
  author: string;
  meeting_key: number;
  session_key: number;
  hero_figure: string;
  body_md: string;
  figures: Record<string, PostFigure>;
  provenance: Record<string, unknown>;
};

const DIR = join(process.cwd(), "content", "blog");

export function listPosts(): PostDoc[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as PostDoc)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
}

export function readPost(slug: string): PostDoc | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const file = join(DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as PostDoc;
}
