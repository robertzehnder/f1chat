#!/usr/bin/env node
/**
 * extract_claims.mjs — claim extraction over HOLDOUT races (corpus G5).
 *
 * For each linked document of a completed holdout race, the LLM extracts
 * discrete analytical/factual claims as VERBATIM spans of the canonical
 * normalized text (normalize_md / caption_dedup — never llm_cleanup), with
 * a PROVISIONAL 6-way triage category. Every span is mechanically verified
 * as an exact substring before storage (char offsets recorded); failures
 * are counted against the G5 span-validity bar, never silently dropped.
 *
 * Categories (candidate labels — category-2 requires human adjudication
 * before entering any roadmap; the warehouse-executing verifier is a later
 * project with its record shape defined in the plan):
 *   reproducible | calculable-but-missing-metric | source-only-reporting |
 *   unsupported-assertion | opinion | insufficient-evidence
 *
 * Output: corpus/eval/claims_<season>_<meeting>.json (short spans +
 * provenance pointers — never full documents).
 *
 * Usage: node scripts/corpus/extract_claims.mjs [--season 2026] [--meeting K]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertUseAllowed } from "./lib/rights.mjs";
import { anthropicStream } from "./lib/anthropic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..", "..", "..", "corpus", "eval");
const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const onlyMeeting = process.argv.find((a, i) => process.argv[i - 1] === "--meeting") ?? null;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const PROMPT_VERSION = "claim_extraction@1";

const SYSTEM = `You extract discrete claims from professional F1 race analysis for verification against a timing/telemetry data warehouse.

The warehouse holds (OpenF1-style): lap times, sector/mini-sector times, car telemetry (speed/throttle/brake/gear), GPS position, session results, starting grids, pit-lane times (NOT stationary times), stints/tyre compounds, race-control messages, intervals/gaps, weather.

Extract 8-20 of the document's most substantive claims. For each, output a JSON object:
- "quote": a VERBATIM contiguous span copied EXACTLY from the source text (15-60 words, character-for-character, including punctuation)
- "claim": one-sentence restatement of what is being asserted
- "category": one of
  "reproducible" (checkable directly from warehouse data),
  "calculable-but-missing-metric" (computable from warehouse data but needs a derived metric we may not have),
  "source-only-reporting" (paddock info, quotes, team statements, visual observation — not in any timing data),
  "unsupported-assertion" (stated as fact but no evidence offered and not obviously checkable),
  "opinion" (judgment/interpretation, unfalsifiable),
  "insufficient-evidence" (cannot classify)
Output ONLY a JSON array of these objects. The "quote" MUST be copy-pasted exactly — any paraphrase in "quote" is an error.`;

const client = await corpusClient();
const registry = await loadRegistry(client);
mkdirSync(EVAL_DIR, { recursive: true });

const { rows: holdoutDocs } = await client.query(
  `SELECT d.doc_id, d.source_key, d.source_id, d.title, d.meeting_key, d.session_scope,
          f.fetch_id, dv.derivation_id, dv.output_text
   FROM raw.analyst_documents d
   JOIN raw.analyst_fetches f USING (doc_id)
   JOIN raw.analyst_derivations dv ON dv.fetch_id = f.fetch_id
   JOIN core.sessions s ON s.meeting_key = d.meeting_key AND s.session_name = 'Race'
   WHERE d.corpus_split = 'holdout' AND d.link_status = 'linked'
     AND s.date_start < NOW()
     AND EXISTS (SELECT 1 FROM raw.laps l WHERE l.session_key = s.session_key)
     AND dv.kind IN ('normalize_md','caption_dedup') AND dv.status NOT IN ('purged','rejected')
     AND ($1::int IS NULL OR d.meeting_key = $1::int)
   ORDER BY d.meeting_key, d.doc_id`, [onlyMeeting]);

const byMeeting = new Map();
for (const d of holdoutDocs) {
  if (!byMeeting.has(d.meeting_key)) byMeeting.set(d.meeting_key, []);
  byMeeting.get(d.meeting_key).push(d);
}
console.log(`extract: ${holdoutDocs.length} holdout doc(s) across ${byMeeting.size} completed holdout meeting(s)`);

let totalClaims = 0, validSpans = 0;
for (const [meetingKey, docs] of byMeeting) {
  const out = { season, meeting_key: meetingKey, model: MODEL, prompt_version: PROMPT_VERSION, extracted_at: new Date().toISOString(), docs: [] };
  for (const d of docs) {
    assertUseAllowed(registry, d.source_key, "llm_process", "eval_reference");
    let claims;
    try {
      const raw = await anthropicStream({
        model: MODEL, max_tokens: 8000, system: SYSTEM,
        messages: [{ role: "user", content: d.output_text }]
      });
      claims = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    } catch (e) {
      console.error(`  ! ${d.source_key}/${d.source_id}: ${e.message.slice(0, 120)}`);
      continue;
    }
    const rows = [];
    for (const cl of claims) {
      totalClaims++;
      const idx = d.output_text.indexOf(cl.quote);
      const valid = idx >= 0;
      if (valid) validSpans++;
      rows.push({
        quote: cl.quote, claim: cl.claim, category: cl.category,
        span_valid: valid, char_start: valid ? idx : null, char_end: valid ? idx + cl.quote.length : null,
        review_status: "unreviewed"
      });
    }
    out.docs.push({
      doc_id: Number(d.doc_id), source_key: d.source_key, source_id: d.source_id, title: d.title,
      fetch_id: Number(d.fetch_id), derivation_id: Number(d.derivation_id), session_scope: d.session_scope,
      claims: rows
    });
    console.log(`  + ${d.source_key}/${d.source_id.slice(0, 50)}: ${rows.length} claims, ${rows.filter((r) => r.span_valid).length} valid spans`);
  }
  writeFileSync(resolve(EVAL_DIR, `claims_${season}_${meetingKey}.json`), JSON.stringify(out, null, 2) + "\n");
}
const pct = totalClaims ? ((validSpans / totalClaims) * 100).toFixed(1) : "0";
console.log(`extract: ${totalClaims} claims, span validity ${validSpans}/${totalClaims} (${pct}%) — G5 bar: >=98%`);
await client.end();
