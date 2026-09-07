#!/usr/bin/env node
/**
 * report_accounting.mjs — the G2/G3 full-accounting invariant + review queue.
 *
 * Every DISCOVERED doc must be accounted for: linked, excluded, unlinkable,
 * or review_queue — with a stored fetch and a live normalization; zero
 * silent drops. Prints per-source status counts, per-meeting coverage, the
 * review queue, and any invariant violations. Exit 1 on violations.
 *
 * Usage: node scripts/corpus/report_accounting.mjs [--season 2026]
 */
import { corpusClient } from "./lib/db.mjs";

const season = Number(process.argv.find((a, i) => process.argv[i - 1] === "--season") ?? 2026);
const client = await corpusClient();
let violations = 0;

const { rows: statusRows } = await client.query(
  `SELECT source_key, link_status, COUNT(*)::int AS n
   FROM raw.analyst_documents GROUP BY 1, 2 ORDER BY 1, 2`);
console.log("— per-source accounting —");
console.table(statusRows);

const { rows: noFetch } = await client.query(
  `SELECT d.source_key, d.source_id FROM raw.analyst_documents d
   WHERE NOT EXISTS (SELECT 1 FROM raw.analyst_fetches f WHERE f.doc_id = d.doc_id)
     AND d.doc_type <> 'question_notes'`);
if (noFetch.length) { violations += noFetch.length; console.error(`❌ ${noFetch.length} doc(s) with NO fetch:`, noFetch.slice(0, 5)); }
else console.log("✅ every doc has a fetch");

const { rows: noNorm } = await client.query(
  `SELECT d.source_key, d.source_id FROM raw.analyst_documents d
   JOIN raw.analyst_fetches f USING (doc_id)
   WHERE f.artifact_status = 'stored'
     AND NOT EXISTS (
       SELECT 1 FROM raw.analyst_derivations dv
       WHERE dv.fetch_id = f.fetch_id AND dv.kind IN ('normalize_md','caption_dedup') AND dv.status <> 'purged')
   GROUP BY 1, 2`);
if (noNorm.length) { violations += noNorm.length; console.error(`❌ ${noNorm.length} stored fetch(es) with NO normalization:`, noNorm.slice(0, 5)); }
else console.log("✅ every stored fetch has a normalization");

const { rows: coverage } = await client.query(
  `WITH race_meetings AS (
     -- completed = the race session actually PRODUCED laps; phantom calendar
     -- entries for cancelled GPs (e.g. Bahrain/Saudi 2026) have none.
     SELECT s.meeting_key, MAX(s.circuit_short_name) AS circuit, MIN(s.date_start) AS start
     FROM core.sessions s
     WHERE s.year = $1 AND s.session_name = 'Race' AND s.date_start < NOW()
       AND EXISTS (SELECT 1 FROM raw.laps l WHERE l.session_key = s.session_key)
     GROUP BY s.meeting_key)
   SELECT rm.meeting_key, rm.circuit,
          COALESCE(json_object_agg(d.source_key, d.n) FILTER (WHERE d.source_key IS NOT NULL), '{}'::json) AS docs
   FROM race_meetings rm
   LEFT JOIN (
     SELECT meeting_key, source_key, COUNT(*)::int AS n
     FROM raw.analyst_documents WHERE link_status = 'linked' GROUP BY 1, 2) d USING (meeting_key)
   GROUP BY 1, 2 ORDER BY MIN(rm.start)`, [season]);
console.log(`— per-meeting linked coverage (${season}, completed races) —`);
for (const r of coverage) console.log(`  ${String(r.meeting_key).padEnd(6)} ${r.circuit.padEnd(20)} ${JSON.stringify(r.docs)}`);

const { rows: queue } = await client.query(
  `SELECT source_key, source_id, link_reason FROM raw.analyst_documents
   WHERE link_status = 'review_queue' ORDER BY source_key, source_id`);
console.log(`— review queue: ${queue.length} —`);
for (const q of queue) console.log(`  ${q.source_key} ${q.source_id}: ${q.link_reason}`);

console.log(violations ? `\nACCOUNTING: FAIL (${violations} violation(s))` : "\nACCOUNTING: PASS (zero silent drops)");
await client.end();
process.exit(violations ? 1 : 0);
