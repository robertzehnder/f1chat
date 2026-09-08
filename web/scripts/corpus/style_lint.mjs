#!/usr/bin/env node
/**
 * style_lint.mjs — deterministic machine-tells linter + stylometrics.
 *
 * A gate like the similarity guard: drafts fail loudly on constructions the
 * distilled source styles never use and machine prose reaches for
 * reflexively. Runs on any markdown/text file(s). No LLM.
 *
 * Hard tells (each occurrence is a failure):
 *   - "not X. It is/was Y" reversals, "isn't about X, it's about Y"
 *   - "in that order", "in exactly the way", "and that is the point"
 *   - "the number/thing nobody was looking at" hooks
 *   - "it is/it's the kind of", "reads like", "a story about"
 *   - "It was, <aside>." / "It is, <aside>." fragments
 *   - meta-framing: sentences whose subject is "the story"/"this piece"
 *   - wrap-up synthesis heading (Verdict / Conclusion / In the end) at the
 *     end of a race feature (The Race rule: close entries, not the piece)
 * Thresholds (from the dimension docs):
 *   - em-dashes per 100 words > 1.2
 *   - any paragraph > 5 sentences
 *   - sentence-length std-dev < 5 words (monotone rhythm)
 *   - markdown tables in the body (pros deploy ONE figure, not clusters)
 *
 * Usage: node scripts/corpus/style_lint.mjs <file> [more files] [--json]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
if (!files.length) { console.error("usage: style_lint.mjs <file>…"); process.exit(2); }

const HARD_TELLS = [
  [/\bnot (?:a|an|the|about) [^.]{3,80}\.\s+It (?:is|was) (?:a|an|the|about)\b/gi, "not-X. It-was-Y reversal"],
  [/\b(?:isn't|is not|wasn't|was not) about [^,.]{3,60}, (?:it's|it is|it was) about\b/gi, "isn't-about-X-it's-about-Y"],
  [/\bin that order\b/gi, "'in that order'"],
  [/\bin exactly the way\b/gi, "'in exactly the way'"],
  [/\b(?:and )?that (?:is|was) the point\b/gi, "'that is the point'"],
  [/\bthe (?:number|thing|detail|stat|figure) (?:nobody|no one|no-one) (?:was|is) looking at\b/gi, "'the number nobody was looking at' hook"],
  [/\bit(?:'s| is| was) the kind of\b/gi, "'it is the kind of'"],
  [/\breads like\b/gi, "'reads like'"],
  [/\ba story about\b/gi, "'a story about'"],
  [/\bIt (?:was|is), [^.]{2,40}\./g, "'It was, <aside>.' fragment"],
  [/\b(?:the|this) (?:story|piece|narrative) (?:is|was|resolves|reads|tells)\b/gi, "meta-framing (the story is…)"],
  [/\blet that sink in\b|\bhere's the thing\b|\bthe truth is\b|\bmake no mistake\b/gi, "stock hook phrase"],
  [/\b(?:strip out|take away) [^,.]{3,40} and (?:he|she|they|it) (?:is|are)\b/gi, "tidy counterfactual synthesis"]
];
const WRAPUP_HEADING = /^#{1,4}\s*(?:the )?(?:verdict|conclusion|in the end|bottom line|takeaways?|summary)\b/im;

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\|.*\|$/gm, " ")          // tables
    .replace(/^#{1,6}\s.*$/gm, " ")      // headings
    .replace(/^\s*[-*]\s+/gm, "")        // bullets
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>`]/g, "");
}

function analyze(file) {
  const raw = readFileSync(file, "utf8");
  // Recap body only: stop at the appendix/diff headings; drop the italic
  // provenance note under the title.
  const body = raw.split(/^##\s+(?:Traceability|Corpus diff|Appendix)/im)[0]
    .replace(/^\*Draft in the[\s\S]*?\*\s*$/m, "");
  const text = stripMarkdown(body);
  const words = text.split(/\s+/).filter(Boolean);
  const paragraphs = text.replace(/(\d)\.(\d)/g, "$1\u2024$2").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.split(/\s+/).length > 8);
  // Protect decimals (7.1s, 0.264s) and lap-time colons so they don't split sentences.
  const protectedText = text.replace(/\s+/g, " ").replace(/(\d)\.(\d)/g, "$1\u2024$2");
  const sentences = (protectedText.match(/[^.!?]+[.!?]+/g) ?? []).map((s) => s.replace(/\u2024/g, "."));
  const sentLens = sentences.map((s) => s.trim().split(/\s+/).length);
  const mean = sentLens.reduce((a, b) => a + b, 0) / Math.max(1, sentLens.length);
  const sd = Math.sqrt(sentLens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, sentLens.length));
  const emDashes = (text.match(/—/g) ?? []).length;
  const emRate = (emDashes / Math.max(1, words.length)) * 100;
  const firstPerson = (text.match(/\b(?:I|I'm|I'd|I've|for me|my)\b/g) ?? []).length;
  const numbers = (text.match(/\b\d+(?:[.:]\d+)?\b/g) ?? []).length;
  const longParas = paragraphs.filter((p) => (p.match(/[^.!?]+[.!?]+/g) ?? []).length > 5).length;
  const tables = (body.match(/^\|.*\|$/gm) ?? []).length > 0;
  const wrapup = WRAPUP_HEADING.test(body);
  // narrate-vs-interpret proxy: sentences opening on a temporal/narrative cue
  const narrOpen = sentences.filter((s) => /^\s*(?:When|After|As|Then|Once|Following|By lap|On lap)\b/i.test(s)).length;

  const tells = [];
  for (const [re, label] of HARD_TELLS) {
    for (const m of text.matchAll(re)) tells.push({ label, excerpt: m[0].slice(0, 90) });
  }
  const failures = [];
  if (tells.length) failures.push(`${tells.length} machine tell(s)`);
  if (emRate > 1.2) failures.push(`em-dash rate ${emRate.toFixed(2)}/100w (> 1.2)`);
  if (longParas) failures.push(`${longParas} paragraph(s) > 5 sentences`);
  if (sd < 5 && sentLens.length > 10) failures.push(`sentence-length sd ${sd.toFixed(1)} (< 5, monotone)`);
  if (tables) failures.push("markdown table in body (deploy one figure, not a cluster)");
  if (wrapup) failures.push("wrap-up synthesis heading (close entries, not the piece)");

  return {
    file: basename(file), words: words.length, paragraphs: paragraphs.length, sentences: sentences.length,
    meanSentenceLen: +mean.toFixed(1), sentenceLenSd: +sd.toFixed(1), emDashPer100w: +emRate.toFixed(2),
    firstPerson, numbersPerParagraph: +(numbers / Math.max(1, paragraphs.length)).toFixed(2),
    narrativeOpeners: narrOpen, longParagraphs: longParas, tables, wrapupHeading: wrapup,
    tells, failures
  };
}

let anyFail = false;
const reports = files.map(analyze);
if (asJson) { console.log(JSON.stringify(reports, null, 2)); }
else {
  for (const r of reports) {
    console.log(`\n${r.file}: ${r.words} words, ${r.paragraphs} paras, ${r.sentences} sentences`);
    console.log(`  sentence len mean ${r.meanSentenceLen} sd ${r.sentenceLenSd} | em-dash/100w ${r.emDashPer100w} | first-person ${r.firstPerson} | numbers/para ${r.numbersPerParagraph} | narrative openers ${r.narrativeOpeners}`);
    for (const t of r.tells) console.log(`  ✗ ${t.label}: "${t.excerpt}"`);
    for (const f of r.failures.filter((f) => !f.includes("machine tell"))) console.log(`  ✗ ${f}`);
    console.log(r.failures.length ? `  STYLE LINT: FAIL (${r.failures.join("; ")})` : "  STYLE LINT: PASS");
  }
}
anyFail = reports.some((r) => r.failures.length);
process.exit(anyFail ? 1 : 0);
