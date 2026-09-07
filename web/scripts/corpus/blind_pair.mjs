#!/usr/bin/env node
/**
 * blind_pair.mjs — the only real test for "feels human": blind pairwise
 * reading (corpus eval instrument 3).
 *
 *   build --meeting <K> --ours <draft.md> [--pro <doc_id>]
 *     Pairs our draft with a topic-matched PRO piece on the same race
 *     (validation split only — never holdout), strips bylines/brand cues,
 *     randomizes A/B with a seeded coin, writes
 *     corpus/eval/blind/pairs/<pair_id>.md (GIT-IGNORED: contains
 *     copyrighted full text) and the answer key to
 *     corpus/eval/blind/keys/<pair_id>.json (also ignored — don't peek).
 *   vote --pair <id> --pick A|B --confidence 1-5 [--who name]
 *     Records a human vote to corpus/eval/blind/votes.jsonl (committed —
 *     it holds no source text), reveals the answer, prints the running
 *     detection rate. Target: ~50% (indistinguishable).
 *   judge --pair <id>
 *     Asks the LLM which is the human, to corpus/eval/blind/judge_votes.jsonl —
 *     for calibrating style_judge.mjs's human_likelihood against real votes.
 *   tally
 *     Prints human vs judge detection rates.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { withCorpus } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { anthropicStream } from "./lib/anthropic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BLIND = resolve(HERE, "..", "..", "..", "corpus", "eval", "blind");
const PAIRS = resolve(BLIND, "pairs"), KEYS = resolve(BLIND, "keys");
const VOTES = resolve(BLIND, "votes.jsonl"), JVOTES = resolve(BLIND, "judge_votes.jsonl");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
for (const d of [PAIRS, KEYS]) mkdirSync(d, { recursive: true });

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k) => argv.find((a, i) => argv[i - 1] === `--${k}`);

/** Strip bylines, brand mentions, links, membership callouts — keep prose structure. */
function anonymize(text) {
  return text
    .replace(/\*\*\\?-\s*[A-Z][\w'.-]+(?: [A-Z][\w'.-]+)+\*\*/g, "")          // **- Byline Name**
    .replace(/—\s*\*[A-Z][\w'.-]+(?: [A-Z][\w'.-]+)+\*/g, "")                 // — *Byline*
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")                                    // links → text
    .replace(/\bThe Race(?: Team| Members'? Club)?\b/g, "this publication")
    .replace(/\bF1 Debrief\b/g, "this newsletter")
    .replace(/^.*(?:subscribe|membership|patreon|sign up).*$/gim, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

if (cmd === "build") {
  const meeting = Number(opt("meeting"));
  const oursFile = opt("ours");
  const proOverride = opt("pro") ? Number(opt("pro")) : null;
  if (!meeting || !oursFile) { console.error("build --meeting K --ours file [--pro doc_id]"); process.exit(2); }
  const ours = readFileSync(oursFile, "utf8").split(/^---\s*$/m).slice(0, 2).join("\n").replace(/^\*Draft in the[\s\S]*?\*\s*$/m, "").trim();

  const { registry, pro } = await withCorpus(async (client) => {
    const registry = await loadRegistry(client);
    const { rows } = await client.query(
      `SELECT DISTINCT ON (d.doc_id) d.doc_id, d.source_key, d.source_id, d.title, d.corpus_split, dv.output_text
       FROM raw.analyst_documents d
       JOIN raw.analyst_fetches f USING (doc_id)
       JOIN raw.analyst_derivations dv ON dv.fetch_id = f.fetch_id
       WHERE d.meeting_key = $1 AND d.link_status = 'linked' AND d.doc_type = 'race_analysis'
         AND d.session_scope = 'race'
         AND dv.kind = 'normalize_md' AND dv.status NOT IN ('purged','rejected')
         AND ($2::bigint IS NULL OR d.doc_id = $2::bigint)
       ORDER BY d.doc_id, dv.derivation_id DESC`, [meeting, proOverride]);
    // prefer a race-day verdict piece of comparable length
    const cands = rows.filter((r) => r.corpus_split !== "holdout");
    if (rows.length && !cands.length) throw new Error("only HOLDOUT pro pieces exist for this meeting — blind pairs must use validation/dev races");
    cands.sort((a, b) => Math.abs(a.output_text.length - ours.length) - Math.abs(b.output_text.length - ours.length));
    return { registry, pro: cands[0] };
  });
  if (!pro) { console.error("no linked race_analysis pro piece for that meeting"); process.exit(1); }
  assertUseAllowed(registry, pro.source_key, "store_full_text", "eval_reference");

  const pairId = `${meeting}-${createHash("sha1").update(oursFile + pro.doc_id).digest("hex").slice(0, 6)}`;
  const coin = parseInt(createHash("sha1").update(`blind-${pairId}`).digest("hex").slice(0, 8), 16) % 2;
  const A = coin ? ours : anonymize(pro.output_text);
  const B = coin ? anonymize(pro.output_text) : ours;
  const sheet = `# Blind pair ${pairId} — which one was written by a human?\n\nRead both. Do not look at corpus/eval/blind/keys/. Then vote:\n\n    node scripts/corpus/blind_pair.mjs vote --pair ${pairId} --pick A --confidence 3\n\n---\n\n## TEXT A\n\n${A}\n\n---\n\n## TEXT B\n\n${B}\n`;
  writeFileSync(resolve(PAIRS, `${pairId}.md`), sheet);
  writeFileSync(resolve(KEYS, `${pairId}.json`), JSON.stringify({
    pair_id: pairId, meeting_key: meeting, human_is: coin ? "B" : "A",
    ours_file: oursFile, pro_doc_id: Number(pro.doc_id), pro_source: pro.source_key, pro_title: pro.title,
    built_at: new Date().toISOString()
  }, null, 2) + "\n");
  console.log(`built pair ${pairId}: corpus/eval/blind/pairs/${pairId}.md (pro: ${pro.source_key} "${(pro.title ?? "").slice(0, 60)}")`);
}

if (cmd === "vote") {
  const pairId = opt("pair"), pick = (opt("pick") || "").toUpperCase(), conf = Number(opt("confidence") ?? 3);
  const who = opt("who") ?? "owner";
  const key = JSON.parse(readFileSync(resolve(KEYS, `${pairId}.json`), "utf8"));
  const correct = pick === key.human_is;
  appendFileSync(VOTES, JSON.stringify({ pair_id: pairId, who, pick, confidence: conf, correct, at: new Date().toISOString() }) + "\n");
  console.log(`${correct ? "✔ detected" : "✘ fooled"} — the human piece was ${key.human_is} (${key.pro_source}: "${(key.pro_title ?? "").slice(0, 60)}")`);
  tally();
}

if (cmd === "judge") {
  const pairId = opt("pair");
  const sheet = readFileSync(resolve(PAIRS, `${pairId}.md`), "utf8");
  const key = JSON.parse(readFileSync(resolve(KEYS, `${pairId}.json`), "utf8"));
  const registry = await withCorpus((c) => loadRegistry(c));
  assertUseAllowed(registry, key.pro_source, "llm_process", "eval_reference");
  const out = await anthropicStream({
    model: MODEL, max_tokens: 400,
    system: "You are a seasoned F1 reader. One of the two texts was written by a working human analyst, the other by an AI. Output ONLY JSON: {\"human_is\":\"A\"|\"B\",\"confidence\":1-5,\"tells\":\"<=40 words on what gave the AI away\"}",
    messages: [{ role: "user", content: sheet.split("---").slice(1).join("---") }]
  });
  const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  const correct = j.human_is === key.human_is;
  appendFileSync(JVOTES, JSON.stringify({ pair_id: pairId, model: MODEL, pick: j.human_is, confidence: j.confidence, correct, tells: j.tells, at: new Date().toISOString() }) + "\n");
  console.log(`judge picked ${j.human_is} (conf ${j.confidence}) — ${correct ? "detected" : "fooled"}. Tells: ${j.tells}`);
}

function tally() {
  for (const [label, file] of [["human", VOTES], ["llm-judge", JVOTES]]) {
    if (!existsSync(file)) continue;
    const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const n = rows.length, k = rows.filter((r) => r.correct).length;
    console.log(`${label}: detected ${k}/${n} (${n ? Math.round((100 * k) / n) : 0}%; target ≈50% = indistinguishable)`);
  }
}
if (cmd === "tally") tally();
if (!["build", "vote", "judge", "tally"].includes(cmd)) { console.error("commands: build | vote | judge | tally"); process.exit(2); }
