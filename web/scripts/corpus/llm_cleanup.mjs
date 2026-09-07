#!/usr/bin/env node
/**
 * llm_cleanup.mjs — transcript readability pass (corpus stage 2, LLM).
 *
 * For every caption_dedup derivation without a current llm_cleanup child,
 * asks the model to repair punctuation/casing/F1 names WITHOUT changing
 * content, and stores the result as a SEPARATE derivation with
 * parent_derivation_id lineage. The verbatim caption_dedup text remains the
 * canonical evidentiary text — cleanup exists only for style-distillation
 * reading comfort and is NEVER used for claim spans.
 *
 * assertUseAllowed(llm_process) gates every model call.
 *
 * Usage: node scripts/corpus/llm_cleanup.mjs [--limit N]
 * Env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (web/.env.local)
 */
import { createHash } from "node:crypto";
import { withCorpus } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { anthropicStream } from "./lib/anthropic.mjs";

const VERSION = "llm_cleanup@1";
const PURPOSE = "style_research";
const limit = Number(process.argv.find((a, i) => process.argv[i - 1] === "--limit") ?? Infinity);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const SYSTEM = `You repair auto-generated captions of an F1 analysis video for readability.
Rules — follow exactly:
- Fix punctuation, sentence casing, and obvious speech-to-text errors in F1 names (drivers, teams, circuits, corners).
- Merge caption fragments into flowing sentences and paragraphs.
- Keep every [mm:ss] timestamp marker on its own line where it appears.
- Do NOT add, remove, summarize, or reorder content. Do NOT invent numbers or names not clearly intended by the audio text.
- Output ONLY the repaired transcript, no preamble.`;

// Gather with a short-lived connection, then work WITHOUT one held open —
// Neon terminates connections left idle across multi-minute LLM streams.
const { registry, pending } = await withCorpus(async (client) => ({
  registry: await loadRegistry(client),
  pending: (await client.query(
  `SELECT dv.derivation_id, dv.fetch_id, dv.output_text, dv.output_sha256, d.source_key, d.source_id
   FROM raw.analyst_derivations dv
   JOIN raw.analyst_fetches f USING (fetch_id)
   JOIN raw.analyst_documents d USING (doc_id)
   WHERE dv.kind = 'caption_dedup' AND dv.status <> 'purged'
     AND NOT EXISTS (
       SELECT 1 FROM raw.analyst_derivations c
       WHERE c.parent_derivation_id = dv.derivation_id AND c.kind = 'llm_cleanup'
         AND c.tool_version = $1 AND c.status <> 'purged')
   ORDER BY dv.derivation_id`, [VERSION])).rows
}));
console.log(`llm_cleanup: ${pending.length} transcript(s) pending (model ${MODEL})`);

let done = 0, errors = 0;
for (const p of pending.slice(0, limit)) {
  try {
    assertUseAllowed(registry, p.source_key, "llm_process", PURPOSE);
    console.log(`  → ${p.source_id} (${p.output_text.length} chars)…`);
    // Streamed request — long transcripts take minutes and a non-streaming
    // fetch times out waiting for headers that only arrive with the body.
    const text = (await anthropicStream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: p.output_text }]
    })).trim();
    if (!text || text.length < p.output_text.length * 0.5) throw new Error(`suspicious output length ${text?.length}`);
    await withCorpus((client) => client.query(
      `INSERT INTO raw.analyst_derivations
         (fetch_id, parent_derivation_id, kind, tool_version, input_sha256, output_sha256, output_text)
       VALUES ($1, $2, 'llm_cleanup', $3, $4, $5, $6)`,
      [p.fetch_id, p.derivation_id, `${VERSION}|${MODEL}`, p.output_sha256, sha256(text), text]));
    done++;
    console.log(`  + ${p.source_id}`);
  } catch (e) {
    console.error(`  ! ${p.source_id}: ${e.message}`); errors++;
  }
}
console.log(`llm_cleanup: ${done} cleaned, ${errors} error(s)`);
process.exit(errors && !done ? 1 : 0);
