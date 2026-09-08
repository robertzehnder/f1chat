#!/usr/bin/env node
/**
 * style_judge.mjs — LLM style-fidelity judge (corpus eval instrument 1).
 *
 * Scores a draft against 14 rules distilled from the source registers
 * (corpus/style/dimensions/*.md), 0-2 each, four dimensions, plus a
 * human-likelihood estimate that gets CALIBRATED against blind human votes
 * (blind_pair.mjs) — never trusted on its own. Can also score a corpus PRO
 * piece (--pro <doc_id>) so the pros' own band becomes the target.
 *
 * Every model call passes assertUseAllowed(llm_process, eval_reference)
 * when corpus text is involved.
 *
 * Usage: node scripts/corpus/style_judge.mjs <draft.md> [--pro <doc_id>…]
 * Writes corpus/eval/style/judge_<name>_<ts>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withCorpus } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { anthropicStream } from "./lib/anthropic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "..", "..", "corpus", "eval", "style");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const args = process.argv.slice(2);
const draftFiles = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--pro" && args[i - 1] !== "--mode");
const proIds = args.filter((a, i) => args[i - 1] === "--pro").map(Number);

// --mode columnist (v1 rules, jump-cut register) | narrative (v2: flowing analytical
// article — owner-selected register 2026-09-08; rules distilled from
// corpus/style/dimensions/hughes_narrative_narrative.md + f1debrief_newsletter_narrative.md)
const MODE = process.argv.find((a, i) => process.argv[i - 1] === "--mode") ?? "columnist";
export const RULES_NARRATIVE = [
  ["S1", "structure", "The opening states the result AND the hinge of the race in the first two paragraphs — a competitive claim, not scene-setting or a greeting."],
  ["S2", "structure", "The body builds in nested layers (observation → contextual correction → mechanism → consequence) and each section hands off to the next; transitions carry information rather than announce structure."],
  ["S3", "structure", "Secondary teams/drivers come after the lead battle is resolved, in descending relevance, handled at pace."],
  ["S4", "structure", "The close leans forward with moderate certainty (next race, an open variable) — it does not restate the argument as a checklist summary."],
  ["E1", "evidence", "Numbers are qualified before conclusions are drawn (tyre age, run length, observed vs estimated); like-for-like gaps are named, not papered over."],
  ["E2", "evidence", "Uncertainty is folded into the claim mid-sentence, once, where the figure first appears — no isolated 'this is an estimate' apparatus and no repeated hedging."],
  ["E3", "evidence", "Quotes, radio or official record respond to a claim already made analytically — they confirm or complicate; they never lead a section."],
  ["E4", "evidence", "Every figure does work; precision signals authority and vague language is reserved for genuinely unknown quantities; causes that come from reporting are attributed."],
  ["R1", "register", "A confident, first-person-absent analytical voice: findings stated as findings, not prefaced with 'I think'; the reader is trusted, not addressed."],
  ["R2", "register", "Rhetorical questions only at genuine pivots; dry wit as a fragment or parenthetical, understatement over emphasis; no personality tokens."],
  ["R3", "register", "Technical vocabulary used precisely without definition; no stock openers/closers, no greetings, no 'let's dive in'."],
  ["P1", "pacing", "Short dense opening paragraph; mechanical-explanation paragraphs may run long (4–8 sentences) because depth is dwelt on, not summarised."],
  ["P2", "pacing", "After a dense section the prose resets with a one-clause breath-point; one-sentence pivot paragraphs mark turning points."],
  ["P3", "pacing", "The midfield passage moves at a sentence or two per team; the final sentence is short and syntactically open-ended."]
];
export const RULES_COLUMNIST = [
  ["S1", "structure", "Verdict first: each section/entry opens on its sharpest evaluative claim; evidence follows the verdict, never the reverse."],
  ["S2", "structure", "No wrap-up synthesis: the piece closes when the last entry closes — no summary paragraph restating the argument."],
  ["S3", "structure", "Abrupt transitions: headings do the transitional work; no bridging sentences between sections."],
  ["E1", "evidence", "One surgical number per claim: precise figures deployed singly to clinch a point, not clustered or tabulated (tables only for midfield hierarchy)."],
  ["E2", "evidence", "Graduated, owned hedging: speculation carries explicit markers (probably / it looks like / I wonder if), certainty only for documented outcomes; hedges never collapse into false neutrality."],
  ["E3", "evidence", "Team-mate is the default benchmark for individual performance before any absolute comparison."],
  ["E4", "evidence", "Quotes, radio, or official messages serve as evidentiary punctuation — a hard stop confirming or complicating the reading just given."],
  ["R1", "register", "Interprets, never narrates: assumes the reader watched; no recap of the running order; the job is meaning, not sequence."],
  ["R2", "register", "Dry irony and understatement over exclamation or rhetorical flourish; comic effect via juxtaposition and flat recounting."],
  ["R3", "register", "Personality as accent: first person appears only to flag a judgment call or genuine surprise; no sentences about the piece or the story itself."],
  ["R4", "register", "Peer address: names without introduction, jargon without definition, no explaining the obvious to an enthusiast."],
  ["P1", "pacing", "Short paragraphs (2-4 sentences), each making one point and exiting."],
  ["P2", "pacing", "Push-pull rhythm: long analytical sentences answered by short punchy ones; sentence length varies visibly within paragraphs."],
  ["P3", "pacing", "Density peaks at the mechanism, relaxes into a coda; length signals significance (big stories get room, clear-cut ones get two sentences)."]
];
export const RULES = MODE === "narrative" ? RULES_NARRATIVE : RULES_COLUMNIST;
const JUDGE_VERSION = `style_judge@${MODE === "narrative" ? "2-narrative" : "1"}`;

const SYSTEM = `You are a strict style editor for professional F1 race analysis (${MODE === "narrative" ? "flowing analytical ARTICLE register — connected sections, chronology as spine, restrained third person" : "columnist register — verdict-first entries, jump cuts"}). You score a text against 14 house rules distilled from professional analysts' work. Be harsh and specific: a 2 means the text does this as well as a professional; 1 means partially or inconsistently; 0 means it violates the rule or shows the opposite (machine-prose) habit.

Rules:
${RULES.map(([id, dim, rule]) => `${id} (${dim}): ${rule}`).join("\n")}

Also estimate human_likelihood (0-100): the probability a seasoned F1 reader would believe this was written by a working human analyst rather than an AI. Consider: rhetorical symmetry, self-admiring framing, tidy triads, over-balanced sentences, generic hooks, absence of specific texture (quotes, named corners, dry asides).

Output ONLY JSON:
{"scores":[{"id":"S1","score":0|1|2,"evidence":"<=25-word quote or observation from the text"}...],
 "dimension_totals":{"structure":n,"evidence":n,"register":n,"pacing":n},
 "total":n, "max":28,
 "human_likelihood":0-100,
 "top_fixes":["...", "...", "..."]}`;

mkdirSync(OUT_DIR, { recursive: true });

async function judge(label, text, purposeSource) {
  const out = await anthropicStream({
    model: MODEL, max_tokens: 3000, system: SYSTEM,
    messages: [{ role: "user", content: `TEXT TO SCORE (${label}):\n\n${text}` }]
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  json.label = label; json.model = MODEL; json.judge_version = JUDGE_VERSION; json.scored_at = new Date().toISOString();
  json.source = purposeSource;
  return json;
}

const results = [];
for (const f of draftFiles) {
  const raw = readFileSync(f, "utf8");
  const body = raw.split(/^---\s*$/m).slice(0, 2).join("\n"); // recap body, not appendix
  console.log(`judging draft ${basename(f)}…`);
  results.push(await judge(basename(f), body, "draft"));
}

if (proIds.length) {
  const { registry, docs } = await withCorpus(async (client) => ({
    registry: await loadRegistry(client),
    docs: (await client.query(
      `SELECT DISTINCT ON (d.doc_id) d.doc_id, d.source_key, d.title, dv.output_text
       FROM raw.analyst_documents d
       JOIN raw.analyst_fetches f USING (doc_id)
       JOIN raw.analyst_derivations dv ON dv.fetch_id = f.fetch_id
       WHERE d.doc_id = ANY($1::bigint[]) AND dv.kind = 'normalize_md' AND dv.status NOT IN ('purged','rejected')
       ORDER BY d.doc_id, dv.derivation_id DESC`, [proIds])).rows
  }));
  for (const d of docs) {
    assertUseAllowed(registry, d.source_key, "llm_process", "eval_reference");
    console.log(`judging PRO reference doc ${d.doc_id} (${d.source_key}: ${(d.title ?? "").slice(0, 50)})…`);
    results.push(await judge(`PRO:${d.source_key}:${d.doc_id}`, d.output_text, d.source_key));
  }
}

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = resolve(OUT_DIR, `judge_${MODE}_${ts}.json`);
writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");

console.log("\n=== STYLE JUDGE ===");
console.log("label".padEnd(44), "struct", "evid ", "regis", "pace ", "total", "human%");
for (const r of results) {
  const d = r.dimension_totals;
  console.log(r.label.slice(0, 43).padEnd(44), String(d.structure).padStart(6), String(d.evidence).padStart(5), String(d.register).padStart(5), String(d.pacing).padStart(5), `${r.total}/28`.padStart(5), String(r.human_likelihood).padStart(6));
}
for (const r of results.filter((r) => r.source === "draft")) {
  console.log(`\nTop fixes for ${r.label}:`);
  for (const fx of r.top_fixes) console.log("  •", fx);
  console.log("Rule scores:", r.scores.map((s) => `${s.id}=${s.score}`).join(" "));
}
console.log(`\nwrote ${outFile}`);
