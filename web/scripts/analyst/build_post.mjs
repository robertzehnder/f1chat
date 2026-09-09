#!/usr/bin/env node
/**
 * build_post.mjs — assemble a blog post document from the verified article
 * and the compiled figures (visuals plan S1.5-lite, file-backed store).
 *
 *   node scripts/analyst/build_post.mjs --meeting 2026_1293
 *
 * Inputs:  analyst/<meeting>/post.md        the article of record with {{fig:name}} lines
 *          analyst/<meeting>/post.meta.json slug, dek, dates, hero figure
 *          analyst/<meeting>/figures/*.json compiled + verified figures
 *          analyst/<meeting>/report.md      the verified prose (post.md minus placeholders MUST equal it)
 * Output:  web/content/blog/<slug>.json
 *
 * Gates (all fail closed): prose identity with report.md, every placeholder
 * resolves, every figure carries verification.ok = true, every figure's chart
 * type is self-contained (no render-time fetch), and every figure's packet
 * provenance matches the packet on disk.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const argv = process.argv.slice(2);
const opt = (k) => argv.find((a, i) => argv[i - 1] === `--${k}`);
const MEETING = opt("meeting") ?? "2026_1293";
const DIR = resolve(ROOT, "analyst", MEETING);
const OUT_DIR = resolve(ROOT, "web", "content", "blog");
mkdirSync(OUT_DIR, { recursive: true });

// Self-contained chart types only (visuals plan §1): no render-time fetches.
const PUBLISHABLE_CHART_TYPES = new Set(["race_trace", "position_changes", "line", "line_with_stint_markers", "stint_gantt", "grouped_bar", "horizontal_bar", "horizontal_bar_diverging", "stacked_horizontal_bar", "line_dual_axis", "event_timeline", "scatter_with_regression", "degradation_curve", "pit_event_strip", "donut", "radar", "status_grid", "metric_grid"]);

const fail = (m) => { console.error(`❌ ${m}`); process.exit(1); };
const norm = (t) => t.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

const meta = JSON.parse(readFileSync(resolve(DIR, "post.meta.json"), "utf8"));
const postMd = readFileSync(resolve(DIR, "post.md"), "utf8");
const reportMd = readFileSync(resolve(DIR, "report.md"), "utf8").split("\n---\n")[0].replace(/^\*Draft in the[\s\S]*?\*\s*$/m, "");
const packet = JSON.parse(readFileSync(resolve(DIR, "packet.json"), "utf8"));

// 1. prose identity: post.md minus placeholders == report.md body
const postParas = norm(postMd);
const placeholders = postParas.filter((p) => /^\{\{fig:[a-z0-9_-]+\}\}$/i.test(p));
const prose = postParas.filter((p) => !/^\{\{fig:[a-z0-9_-]+\}\}$/i.test(p));
const report = norm(reportMd);
if (prose.length !== report.length || prose.some((p, i) => p !== report[i])) {
  const i = prose.findIndex((p, j) => p !== report[j]);
  fail(`post.md prose differs from report.md at paragraph ${i + 1}: "${(prose[i] ?? "").slice(0, 60)}…" vs "${(report[i] ?? "").slice(0, 60)}…"`);
}
const title = report[0].startsWith("# ") ? report[0].slice(2).trim() : fail("report.md must start with a # title");

// 2. figures
const figures = {};
for (const f of readdirSync(resolve(DIR, "figures")).filter((x) => x.endsWith(".json"))) {
  const fig = JSON.parse(readFileSync(resolve(DIR, "figures", f), "utf8"));
  if (!fig.verification?.ok) fail(`figure ${fig.name}: not verified (run figures.mjs --verify)`);
  if (!PUBLISHABLE_CHART_TYPES.has(fig.chart.type)) fail(`figure ${fig.name}: chart type ${fig.chart.type} is not self-contained`);
  if (fig.provenance.packet_built_at !== packet.manifest.built_at) fail(`figure ${fig.name}: compiled from a different packet (${fig.provenance.packet_built_at} vs ${packet.manifest.built_at}); rerun figures.mjs`);
  figures[fig.name] = {
    name: fig.name, chart: fig.chart, caption: fig.caption.rendered, alt: fig.alt.rendered, verified: true,
    provenance: { ...fig.provenance, caption_slots: Object.keys(fig.caption.slots).length, content_sha256: createHash("sha256").update(JSON.stringify({ chart: fig.chart, caption: fig.caption.rendered, alt: fig.alt.rendered })).digest("hex") }
  };
}
for (const ph of placeholders) { const name = ph.match(/^\{\{fig:([a-z0-9_-]+)\}\}$/i)[1]; if (!figures[name]) fail(`placeholder {{fig:${name}}} has no compiled figure`); }
if (!figures[meta.hero_figure]) fail(`hero figure ${meta.hero_figure} missing`);

const doc = {
  slug: meta.slug, title, dek: meta.dek, published_at: meta.published_at, author: meta.author ?? "F1 Chat analyst",
  meeting_key: meta.meeting_key, session_key: meta.session_key, hero_figure: meta.hero_figure,
  body_md: postParas.join("\n\n"), figures,
  provenance: { meeting: MEETING, packet_version: packet.manifest.packet_version, packet_built_at: packet.manifest.built_at, report_sha256: createHash("sha256").update(reportMd).digest("hex"), built_at: new Date().toISOString(), store: "file-backed draft (migration 063 revision model pending)" }
};
doc.provenance.content_sha256 = createHash("sha256").update(JSON.stringify({ body: doc.body_md, figures: Object.values(figures).map((f) => f.provenance.content_sha256) })).digest("hex");
writeFileSync(resolve(OUT_DIR, `${meta.slug}.json`), JSON.stringify(doc, null, 1) + "\n");
console.log(`✅ wrote web/content/blog/${meta.slug}.json — ${prose.length} paragraphs, ${placeholders.length} figures, content ${doc.provenance.content_sha256.slice(0, 12)}`);
