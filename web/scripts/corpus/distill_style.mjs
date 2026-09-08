#!/usr/bin/env node
/**
 * distill_style.mjs — style distillation (corpus G4, LLM, run rarely).
 *
 * Reads ONLY dev-split documents (the leakage boundary), one group per
 * (source register): The Race race analysis, Straw ratings, F1.com strategy
 * guides, the Substack newsletter, Palmer transcripts (llm_cleanup text).
 * Produces per-group DIMENSION docs (structure / evidentiary practice /
 * register / pacing — rules and content-free skeletons, never quotes) in
 * corpus/style/dimensions/, then assembles the deliberate COMPOSITE voice in
 * corpus/style/composite_voice_v1.md. A run manifest pinning every
 * (doc, fetch, derivation) consumed is written to corpus/manifests/.
 *
 * assertUseAllowed(llm_process, style_research) gates every model call —
 * which is exactly why x_exemplars (format_study only) can never enter here.
 *
 * Usage: node scripts/corpus/distill_style.mjs [--season 2026]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { anthropicStream } from "./lib/anthropic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = resolve(HERE, "..", "..", "..", "corpus", "style");
const MANIFEST_DIR = resolve(HERE, "..", "..", "..", "corpus", "manifests");
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// --profile columnist (default, v1) | narrative (v2: flowing analytical article — owner decision 2026-09-08)
const PROFILE = process.argv.find((a, i) => process.argv[i - 1] === "--profile") ?? "columnist";
const SUFFIX = PROFILE === "narrative" ? "_narrative" : "";
const SEASONS = PROFILE === "narrative" ? [2025, 2026] : [season];

const GROUPS_COLUMNIST = [
  { key: "therace_race_analysis", label: "The Race — post-race analysis features", sourceKey: "the_race", docType: "race_analysis" },
  { key: "straw_driver_ratings", label: "Edd Straw — per-race driver ratings", sourceKey: "the_race", docType: "driver_ratings" },
  { key: "f1com_strategy", label: "Formula1.com — race strategy guides", sourceKey: "f1com", docType: "strategy_report" },
  { key: "f1debrief_newsletter", label: "F1 Debrief — per-race newsletter analysis", sourceKey: "substack:f1debrief", docType: "race_analysis" },
  { key: "palmer_transcripts", label: "Jolyon Palmer — onboard/telemetry video analysis (spoken)", sourceKey: "youtube:formula1", docType: "transcript" }
];
const GROUPS_NARRATIVE = [
  { key: "hughes_narrative", label: "Mark Hughes — flowing analytical race narrative (The Race, 2025)", sourceKey: "the_race", docType: "race_analysis", slugLike: "%mark-hughes%" },
  { key: "f1debrief_newsletter", label: "F1 Debrief — per-race newsletter narrative", sourceKey: "substack:f1debrief", docType: "race_analysis" },
  { key: "therace_race_analysis", label: "The Race — post-race features (secondary register)", sourceKey: "the_race", docType: "race_analysis", slugNotLike: "%mark-hughes%" },
  { key: "palmer_transcripts", label: "Jolyon Palmer — spoken analysis (tertiary)", sourceKey: "youtube:formula1", docType: "transcript" }
];
const GROUPS = PROFILE === "narrative" ? GROUPS_NARRATIVE : GROUPS_COLUMNIST;

const DIMENSION_SYSTEM = `You are a writing-style analyst distilling a STYLE GUIDE from professional F1 analysis.
Output RULES and CONTENT-FREE STRUCTURAL SKELETONS only. HARD CONSTRAINTS:
- NEVER quote more than 4 consecutive words from the source material.
- No facts, names, numbers, or events from the sources may appear in your output — describe HOW they write, never WHAT they wrote about.
Produce exactly these four sections, each with 5-10 concrete, imitable rules:
## STRUCTURE (how a piece opens, builds its argument, and closes; a skeleton outline with placeholder slots)
## EVIDENTIARY PRACTICE (how claims are grounded, what counts as evidence, how numbers are deployed, how speculation is hedged vs asserted)
## REGISTER (vocabulary level, technicality, personality, how the reader is addressed)
## PACING (sentence and paragraph rhythm, how long the piece dwells per point, where density peaks)`;

const client = await corpusClient();
const registry = await loadRegistry(client);
mkdirSync(resolve(STYLE_DIR, "dimensions"), { recursive: true });
mkdirSync(MANIFEST_DIR, { recursive: true });

const manifest = { run: `distill_style${SUFFIX || "_v1"}`, profile: PROFILE, model: MODEL, season, started_at: new Date().toISOString(), groups: {} };

// GATHER first with the connection open, THEN do the LLM work with no DB
// connection held (Neon terminates idle connections mid-stream).
const gathered = [];
for (const g of GROUPS) {
  // dev-split docs only; latest good normalization; transcripts read the
  // llm_cleanup child (readability), never as evidence.
  const { rows: docs } = await client.query(
    `SELECT DISTINCT ON (d.doc_id)
            d.doc_id, d.title, d.meeting_key, d.corpus_split, f.fetch_id, dv.derivation_id, dv.output_text
     FROM raw.analyst_documents d
     JOIN raw.analyst_fetches f USING (doc_id)
     JOIN raw.analyst_derivations dv ON dv.fetch_id = f.fetch_id
     LEFT JOIN raw.analyst_derivations cl ON cl.parent_derivation_id = dv.derivation_id AND cl.kind = 'llm_cleanup' AND cl.status NOT IN ('purged','rejected')
     WHERE d.source_key = $1 AND d.doc_type = $2
       AND d.corpus_split = 'dev' AND d.link_status = 'linked'
       AND ($3::text IS NULL OR d.source_id LIKE $3)
       AND ($4::text IS NULL OR d.source_id NOT LIKE $4)
       AND EXISTS (SELECT 1 FROM core.sessions s WHERE s.meeting_key = d.meeting_key AND s.year = ANY($5::int[]))
       AND dv.status NOT IN ('purged','rejected')
       AND ((d.doc_type <> 'transcript' AND dv.kind IN ('normalize_md'))
            OR (d.doc_type = 'transcript' AND dv.kind = 'caption_dedup'))
     ORDER BY d.doc_id, dv.derivation_id DESC`,
    [g.sourceKey, g.docType, g.slugLike ?? null, g.slugNotLike ?? null, SEASONS]);

  // transcripts: swap in cleanup text where present
  if (g.docType === "transcript") {
    for (const d of docs) {
      const { rows: [cl] } = await client.query(
        `SELECT derivation_id, output_text FROM raw.analyst_derivations
         WHERE parent_derivation_id = $1 AND kind = 'llm_cleanup' AND status NOT IN ('purged','rejected')
         ORDER BY derivation_id DESC LIMIT 1`, [d.derivation_id]);
      if (cl) { d.output_text = cl.output_text; d.derivation_id = cl.derivation_id; }
    }
  }
  if (docs.length < 3) { console.log(`distill: ${g.key} — only ${docs.length} dev doc(s), skipping`); continue; }
  gathered.push({ g, docs });
}
await client.end();

const dimensionDocs = [];
for (const { g, docs } of gathered) {
  assertUseAllowed(registry, g.sourceKey, "llm_process", "style_research");
  // Cap the exemplar budget per group (~200K chars ≈ 50K tokens) so a large
  // group (The Race features: 67 dev docs / 720K chars) cannot overflow the
  // model context; the most recent docs are kept, the manifest records which.
  const MAX_CHARS = 200_000;
  let used = 0; const kept = [];
  for (const d of [...docs].sort((a, b) => Number(b.doc_id) - Number(a.doc_id))) {
    if (used + d.output_text.length > MAX_CHARS && kept.length >= 3) break;
    kept.push(d); used += d.output_text.length;
  }
  if (kept.length < docs.length) console.log(`distill: ${g.key} — capped to ${kept.length}/${docs.length} docs (${used} chars)`);
  docs.length = 0; docs.push(...kept);
  const corpusText = docs
    .map((d, i) => `=== EXEMPLAR ${i + 1} (${d.title ?? "untitled"}) ===\n${d.output_text}`)
    .join("\n\n");
  console.log(`distill: ${g.key} — ${docs.length} dev docs, ${corpusText.length} chars`);
  const out = await anthropicStream({
    model: MODEL,
    max_tokens: 4000,
    system: DIMENSION_SYSTEM,
    messages: [{ role: "user", content: `Source register: ${g.label}.\n\n${corpusText}` }]
  });
  const header = `# Style dimensions — ${g.label}\n\n> Distilled ${new Date().toISOString().slice(0, 10)} from ${docs.length} dev-split documents (see corpus/manifests/distill_style_v1.json). Rules only — no source content.\n\n`;
  writeFileSync(resolve(STYLE_DIR, "dimensions", `${g.key}${SUFFIX}.md`), header + out.trim() + "\n");
  dimensionDocs.push({ key: g.key, label: g.label, text: out.trim() });
  manifest.groups[g.key] = docs.map((d) => ({
    doc_id: Number(d.doc_id), fetch_id: Number(d.fetch_id), derivation_id: Number(d.derivation_id),
    meeting_key: d.meeting_key, corpus_split: d.corpus_split
  }));
}

console.log("distill: assembling composite voice…");
const COMPOSITE_SYSTEM_NARRATIVE = `You are designing the house voice for "F1 Chat Analyst" — a NEW, deliberate composite voice for a per-race F1 analysis ARTICLE (newsletter-length, flowing). It must NOT imitate or be attributable to any single named analyst.
Product decision (owner, 2026-09-08): the piece reads as ONE continuous article, not a set of jump-cut entries. Sections connect; transitions carry information; chronology is the spine and analysis rides on it; the voice is a restrained third person that steps forward only for a genuine judgment; the ending lands the argument without a checklist summary. The primary model is the flowing analytical race narrative (first dimension guide); the newsletter and post-race-feature guides supply hook, pacing and evidentiary habits; the spoken guide supplies graduated confidence language.
Inputs: dimension guides distilled from those registers. Synthesize ONE coherent style guide with sections:
## VOICE (three sentences)
## STRUCTURE (the article spine: opening that states the result AND the hinge in the first two paragraphs → chronological-analytical body where each section hands off to the next → a closing that lands; concrete rules for transitions and section handoffs)
## EVIDENTIARY PRACTICE (hard rules: every number from a supplied data packet; uncertainty stated once, in plain speech, where the figure first appears; observed vs estimated always distinguished; causes attributed when they come from reporting; no proposition about what people thought or felt without a source; quotes or official record woven into the narrative, not appended)
## REGISTER ## PACING (one-sentence pivot paragraphs allowed at turning points; sentence-length variety; no monotone)
## SOCIAL ADAPTATION (how the article compresses to a caption)
## HARD CONSTRAINTS (verbatim-quote ban >4 words from sources; no named-analyst branding; no stock openers/closers; no invented reactions)
Rules must be concrete and imitable. No source content, facts, or events.`;
const COMPOSITE_SYSTEM = PROFILE === "narrative" ? COMPOSITE_SYSTEM_NARRATIVE : `You are designing the house voice for "F1 Chat Analyst" — a NEW, deliberate composite voice for chart-backed, per-race F1 analysis (newsletter + social). It must NOT imitate or be attributable to any single named analyst.
Inputs: dimension guides distilled from several professional registers. Synthesize ONE coherent style guide with sections:
## VOICE (three-sentence identity statement)
## STRUCTURE (the piece skeleton: thesis → mechanism → evidence → caveat → verdict, adapted with concrete rules)
## EVIDENTIARY PRACTICE (hard rules; include: every number must come from a supplied data packet, proxies/estimates are hedged explicitly, absence of data is stated plainly, never invent)
## REGISTER ## PACING ## SOCIAL ADAPTATION (how the long-form voice compresses to a chart caption: 1 chart, 2 sentences, 1 surprising number)
## HARD CONSTRAINTS (verbatim-quote ban >4 words; no named-analyst branding; no unverifiable claims)
Rules must be concrete and imitable. No source content, facts, or events.`;
const compositeOut = await anthropicStream({
  model: MODEL,
  max_tokens: 4000,
  system: COMPOSITE_SYSTEM,
  messages: [{ role: "user", content: dimensionDocs.map((d) => `=== ${d.label} ===\n${d.text}`).join("\n\n") }]
});
const compositeFile = PROFILE === "narrative" ? "composite_voice_v2_narrative.md" : "composite_voice_v1.md";
const compositeTitle = PROFILE === "narrative" ? "composite voice v2 — narrative article (owner-selected register, 2026-09-08)" : "composite voice v1";
writeFileSync(resolve(STYLE_DIR, compositeFile),
  `# F1 Chat Analyst — ${compositeTitle}\n\n> Assembled ${new Date().toISOString().slice(0, 10)} from the dimension guides in corpus/style/dimensions/ (dev split only; manifest: corpus/manifests/distill_style${SUFFIX || "_v1"}.json). PENDING human approval.\n\n` +
  compositeOut.trim() + "\n");

manifest.finished_at = new Date().toISOString();
writeFileSync(resolve(MANIFEST_DIR, `distill_style${SUFFIX || "_v1"}.json`), JSON.stringify(manifest, null, 2) + "\n");
console.log(`distill: done — ${dimensionDocs.length} dimension docs + composite + manifest`);
