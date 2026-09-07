#!/usr/bin/env node
/**
 * similarity_guard.mjs — copied-phrasing detector (corpus G4).
 *
 * Shingle-overlap check between output files (style guides, or any agent
 * output passed as arguments) and EVERY normalized corpus text: 8-word
 * shingles, lowercased, punctuation-stripped. Any overlap is reported with
 * the offending shingle and source doc; exit 1 if any file exceeds the
 * threshold (default 0 shingles — style guides contain rules, not text).
 *
 * Usage: node scripts/corpus/similarity_guard.mjs [files...]
 *        (default: corpus/style/dimensions/*.md + corpus/style/composite_voice_v1.md)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = resolve(HERE, "..", "..", "..", "corpus", "style");
const N = 8;
const THRESHOLD = 0;

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = argFiles.length
  ? argFiles
  : [
      ...(existsSync(join(STYLE_DIR, "dimensions"))
        ? readdirSync(join(STYLE_DIR, "dimensions")).filter((f) => f.endsWith(".md")).map((f) => join(STYLE_DIR, "dimensions", f))
        : []),
      ...(existsSync(join(STYLE_DIR, "composite_voice_v1.md")) ? [join(STYLE_DIR, "composite_voice_v1.md")] : [])
    ];

const tokens = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function shingles(t) {
  const tok = tokens(t);
  const out = new Set();
  for (let i = 0; i + N <= tok.length; i++) out.add(tok.slice(i, i + N).join(" "));
  return out;
}

const client = await corpusClient();
const { rows: corpusRows } = await client.query(
  `SELECT dv.derivation_id, d.source_key, d.source_id, dv.output_text
   FROM raw.analyst_derivations dv
   JOIN raw.analyst_fetches f USING (fetch_id)
   JOIN raw.analyst_documents d USING (doc_id)
   WHERE dv.status NOT IN ('purged','rejected') AND dv.output_text IS NOT NULL`);
console.log(`similarity guard: ${files.length} file(s) vs ${corpusRows.length} corpus text(s), ${N}-word shingles`);

const corpusShingles = new Map(); // shingle -> source label (first seen)
for (const r of corpusRows) {
  for (const s of shingles(r.output_text)) {
    if (!corpusShingles.has(s)) corpusShingles.set(s, `${r.source_key}/${r.source_id}`);
  }
}

let worst = 0;
for (const file of files) {
  const hits = [];
  for (const s of shingles(readFileSync(file, "utf8"))) {
    if (corpusShingles.has(s)) hits.push({ shingle: s, source: corpusShingles.get(s) });
  }
  worst = Math.max(worst, hits.length);
  if (hits.length > THRESHOLD) {
    console.error(`❌ ${basename(file)}: ${hits.length} overlapping shingle(s)`);
    for (const h of hits.slice(0, 5)) console.error(`     "${h.shingle}" ← ${h.source}`);
  } else {
    console.log(`✅ ${basename(file)}: clean`);
  }
}
await client.end();
console.log(worst > THRESHOLD ? "\nSIMILARITY GUARD: FAIL" : "\nSIMILARITY GUARD: PASS");
process.exit(worst > THRESHOLD ? 1 : 0);
