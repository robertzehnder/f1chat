#!/usr/bin/env node
/**
 * repair_spans.mjs — fuzzy re-anchoring for failed claim spans (corpus G5).
 *
 * The extractor requires verbatim quotes; the model sometimes drops a word
 * or "fixes" punctuation. For every span_valid=false claim, this slides a
 * token window over the CANONICAL text and, at >=80% token overlap, replaces
 * the stored quote with the ACTUAL source span (offsets re-verified). The
 * stored quote is therefore always re-read from the canonical text — never
 * the model's transcription. Claims below the similarity floor stay invalid
 * and keep counting against the G5 bar; nothing is dropped.
 *
 * Usage: node scripts/corpus/repair_spans.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..", "..", "..", "corpus", "eval");
const MIN_SIM = 0.8;

// Apostrophes are DELETED (not space-replaced) so "Ferrari's" ≡ "Ferraris" —
// the model routinely drops possessive apostrophes when copying.
const tok = (s) => s.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** Best token-overlap window of ~|quote| tokens in source; returns char span. */
function fuzzyLocate(source, quote) {
  const qTok = tok(quote);
  if (qTok.length < 5) return null;
  // tokenize source WITH char offsets
  // Mask markdown link TARGETS "](url)" — the model quotes rendered text,
  // so URL tokens must not break window contiguity. Offsets stay original.
  const masks = [];
  for (const lm of source.matchAll(/\]\(([^)\s]+)\)/g)) {
    masks.push([lm.index + 1, lm.index + lm[0].length]);
  }
  const masked = (i) => masks.some(([a, b]) => i >= a && i < b);
  const sTok = [];
  const re = /[a-z0-9]+(?:[’'`][a-z0-9]+)*/gi;
  let m;
  while ((m = re.exec(source))) {
    if (masked(m.index)) continue;
    sTok.push({ t: m[0].toLowerCase().replace(/[’'`]/g, ""), start: m.index, end: m.index + m[0].length });
  }
  const qSet = new Map();
  for (const t of qTok) qSet.set(t, (qSet.get(t) ?? 0) + 1);
  let best = { score: 0, i: -1, len: qTok.length };
  for (const len of [qTok.length, qTok.length + 2, Math.max(5, qTok.length - 2)]) {
    for (let i = 0; i + len <= sTok.length; i++) {
      const counts = new Map(qSet);
      let hit = 0;
      for (let j = i; j < i + len; j++) {
        const c = counts.get(sTok[j].t);
        if (c > 0) { counts.set(sTok[j].t, c - 1); hit++; }
      }
      const score = hit / Math.max(len, qTok.length);
      if (score > best.score) best = { score, i, len };
    }
  }
  if (best.score < MIN_SIM || best.i < 0) return null;
  return { start: sTok[best.i].start, end: sTok[best.i + best.len - 1].end, score: best.score };
}

const client = await corpusClient();
const files = readdirSync(EVAL_DIR).filter((f) => /^claims_\d+_\d+\.json$/.test(f));
let total = 0, wereValid = 0, repaired = 0, stillInvalid = 0;

for (const f of files) {
  const data = JSON.parse(readFileSync(join(EVAL_DIR, f), "utf8"));
  // Drop duplicate doc blocks (an early extract-query bug processed docs
  // once per parser-version derivation; the query is fixed, this heals files).
  const seen = new Set();
  data.docs = data.docs.filter((d) => !seen.has(d.doc_id) && seen.add(d.doc_id));
  for (const doc of data.docs) {
    let text = null;
    for (const c of doc.claims) {
      total++;
      if (c.span_valid) { wereValid++; continue; }
      if (text === null) {
        const { rows: [dv] } = await client.query(
          `SELECT output_text FROM raw.analyst_derivations WHERE derivation_id = $1`, [doc.derivation_id]);
        text = dv?.output_text ?? "";
      }
      const loc = fuzzyLocate(text, c.quote);
      if (loc) {
        c.quote = text.slice(loc.start, loc.end);
        c.char_start = loc.start;
        c.char_end = loc.end;
        c.span_valid = true;
        c.span_repair = `fuzzy@${loc.score.toFixed(2)}`;
        repaired++;
      } else {
        stillInvalid++;
      }
    }
  }
  writeFileSync(join(EVAL_DIR, f), JSON.stringify(data, null, 2) + "\n");
}
await client.end();
const valid = wereValid + repaired;
const pct = total ? ((valid / total) * 100).toFixed(1) : "0";
console.log(`repair: ${total} claims — ${wereValid} already valid, ${repaired} re-anchored, ${stillInvalid} still invalid`);
console.log(`span validity now ${valid}/${total} (${pct}%) — G5 bar: >=98%`);
process.exit(0);
