#!/usr/bin/env node
/**
 * g5_review_sheet.mjs — build the stratified human-adjudication sheet
 * (corpus G5 exit bar b).
 *
 * Reads corpus/eval/claims_*.json, reports mechanical span validity (bar a:
 * >=98%), and emits corpus/eval/g5_sample_review.md with a stratified
 * sample (target >=10 per occupied category; underpopulated categories are
 * listed as INSUFFICIENT SAMPLE and remain open — never padded). Every
 * candidate category-2 claim is included in FULL for individual human
 * adjudication (no auto-accept into any roadmap).
 *
 * Usage: node scripts/corpus/g5_review_sheet.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..", "..", "..", "corpus", "eval");
const TARGET_PER_CAT = 10;

const files = readdirSync(EVAL_DIR).filter((f) => /^claims_\d+_\d+\.json$/.test(f));
const all = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(join(EVAL_DIR, f), "utf8"));
  for (const doc of data.docs) {
    for (const c of doc.claims) {
      all.push({ ...c, meeting_key: data.meeting_key, source: `${doc.source_key}/${doc.source_id}`, doc_id: doc.doc_id, derivation_id: doc.derivation_id });
    }
  }
}
const valid = all.filter((c) => c.span_valid);
const pct = all.length ? ((valid.length / all.length) * 100).toFixed(1) : "0";
console.log(`G5 bar (a) span validity: ${valid.length}/${all.length} = ${pct}% (bar: >=98%)`);

const byCat = new Map();
for (const c of valid) {
  if (!byCat.has(c.category)) byCat.set(c.category, []);
  byCat.get(c.category).push(c);
}

let md = `# G5 taxonomy adjudication sheet\n\nGenerated ${new Date().toISOString().slice(0, 16)}Z from ${files.length} holdout claims file(s).\n\n`;
md += `**Bar (a) — span validity: ${valid.length}/${all.length} (${pct}%).** Bar: >=98% mechanical verbatim-substring validity.\n\n`;
md += `**Bar (b) — taxonomy agreement:** for each sampled claim below, mark AGREE or the corrected category. `;
md += `>=80% agreement passes; EVERY candidate category-2 claim needs an individual verdict before it can enter the platform roadmap.\n\n`;

for (const [cat, claims] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const isCat2 = cat === "calculable-but-missing-metric";
  const sample = isCat2 ? claims : claims.slice(0, TARGET_PER_CAT);
  md += `## ${cat} — ${claims.length} claim(s)${isCat2 ? " (ALL listed — individual adjudication required)" : ` (sample of ${sample.length})`}\n\n`;
  if (!isCat2 && claims.length < TARGET_PER_CAT) {
    md += `> ⚠️ INSUFFICIENT SAMPLE (${claims.length} < ${TARGET_PER_CAT}) — category remains OPEN, do not auto-pass.\n\n`;
  }
  sample.forEach((c, i) => {
    md += `${i + 1}. **[meeting ${c.meeting_key}] ${c.source.slice(0, 60)}**\n`;
    md += `   > "${c.quote}"\n`;
    md += `   - claim: ${c.claim}\n   - verdict: ☐ AGREE ☐ corrected: ______\n\n`;
  });
}
writeFileSync(join(EVAL_DIR, "g5_sample_review.md"), md);
console.log(`wrote corpus/eval/g5_sample_review.md — categories: ${[...byCat.entries()].map(([k, v]) => `${k}:${v.length}`).join(", ")}`);
