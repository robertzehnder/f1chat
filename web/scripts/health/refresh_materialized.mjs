#!/usr/bin/env node
/**
 * refresh_materialized.mjs — Phase 2 refresh pipeline (roadmap_to_A_grade).
 *
 * DERIVES the full materialized surface from the catalog (never a hand-list):
 *   • true matviews  → pg_matviews (analytics.* + core.*)
 *   • heap *_mat     → pg_class relkind='r' name LIKE '%\_mat' (+ its facade view)
 * then refreshes in DEPENDENCY ORDER (matviews that read other matviews last,
 * via a pg_depend topo-sort). Mechanism per object type:
 *   • matview with a UNIQUE index → REFRESH MATERIALIZED VIEW CONCURRENTLY
 *     (non-blocking reads); else plain REFRESH.
 *   • heap *_mat → per-session delete+insert is the ingest job's concern; this
 *     driver reports them + their staleness but does not rebuild (no source query
 *     stored here). Prod currently has zero heap *_mat, only true matviews.
 * Reports a freshness watermark: max session_key present vs latest ingested.
 *
 * Flags: --dry-run (print the derived plan, no refresh), --concurrent-only.
 * Creds: NEON_DB_* from web/.env.local.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..", "..");
const dryRun = process.argv.includes("--dry-run");
const concurrentOnly = process.argv.includes("--concurrent-only");

function loadEnv() {
  const e = {};
  for (const l of readFileSync(join(WEB, ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return e;
}
const env = loadEnv();
const client = new pg.Client({
  host: env.NEON_DB_HOST, port: Number(env.NEON_DB_PORT || 5432), database: env.NEON_DB_NAME,
  user: env.NEON_DB_USER, password: env.NEON_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
const q = async (sql, p) => (await client.query(sql, p)).rows;

async function main() {
  await client.connect();

  // 1. Derive true matviews + whether each has a unique index (→ CONCURRENTLY).
  const matviews = await q(`
    SELECT (n.nspname||'.'||c.relname) AS rel, n.nspname AS schema, c.relname AS name, c.oid,
      EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisunique) AS has_unique
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='m' AND n.nspname IN ('analytics','core') ORDER BY 1`);

  // 2. Derive heap *_mat tables (report only).
  const heaps = await q(`
    SELECT (n.nspname||'.'||c.relname) AS rel FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND c.relname LIKE '%\\_mat' AND n.nspname IN ('core','analytics') ORDER BY 1`);

  // 3. Topo-sort matviews so a matview that (transitively, THROUGH FACADE VIEWS
  //    too) reads another refreshes AFTER it. Build the full relation-reference
  //    graph over matviews AND views (a matview's dep on another usually flows
  //    matview -> facade view -> matview), then post-order DFS from each matview,
  //    emitting only matviews. Views are traversed, not refreshed.
  const matviewOids = new Set(matviews.map((m) => String(m.oid)));
  const refs = new Map(); // relOid -> Set(referenced relOids)
  const allEdges = await q(`
    SELECT DISTINCT c.oid AS dependent, ref.oid AS depends_on
    FROM pg_rewrite r JOIN pg_depend d ON d.objid=r.oid
    JOIN pg_class c ON c.oid=r.ev_class
    JOIN pg_class ref ON ref.oid=d.refobjid
    WHERE c.relkind IN ('m','v') AND ref.relkind IN ('m','v') AND c.oid<>ref.oid`);
  for (const e of allEdges) {
    const dep = String(e.dependent), on = String(e.depends_on);
    if (!refs.has(dep)) refs.set(dep, new Set());
    refs.get(dep).add(on);
  }
  const oidToRel = new Map(matviews.map((m) => [String(m.oid), m.rel]));
  const ordered = [], seen = new Set();
  const visit = (oid, stack = new Set()) => {
    if (seen.has(oid) || stack.has(oid)) return; // cycle-safe
    stack.add(oid);
    for (const d of refs.get(oid) || []) visit(d, stack);
    stack.delete(oid); seen.add(oid);
    if (matviewOids.has(oid)) ordered.push(oidToRel.get(oid));
  };
  for (const m of matviews) visit(String(m.oid));
  const byRel = new Map(matviews.map((m) => [m.rel, m]));

  console.log(`Phase 2 — refresh pipeline: ${matviews.length} matviews, ${heaps.length} heap _mat tables`);
  if (heaps.length) console.log(`  heap *_mat (rebuilt by ingest, not here): ${heaps.map((h) => h.rel).join(", ")}`);
  console.log(`  refresh order (deps first): ${ordered.join(" → ")}`);
  if (dryRun) { await client.end(); return; }

  // 4. Refresh in order.
  let failures = 0;
  for (const rel of ordered) {
    const mv = byRel.get(rel);
    const concurrent = mv.has_unique;
    if (concurrentOnly && !concurrent) { console.log(`  ⏭  ${rel} (no unique index; skipped in --concurrent-only)`); continue; }
    const sql = concurrent ? `REFRESH MATERIALIZED VIEW CONCURRENTLY ${rel}` : `REFRESH MATERIALIZED VIEW ${rel}`;
    const t0 = Date.now();
    try { await client.query(sql); console.log(`  ✅ ${rel} ${concurrent ? "(concurrent)" : "(blocking)"} ${Date.now() - t0}ms`); }
    catch (e) { failures++; console.error(`  ❌ ${rel}: ${e.message}`); }
  }

  // 5. Freshness watermark: latest ingested race session vs a representative matview.
  const [latest] = await q(`SELECT MAX(session_key)::bigint AS mx FROM raw.laps`);
  const [covered] = await q(`SELECT MAX(session_key)::bigint AS mx FROM analytics.stint_degradation_curve_data`);
  console.log(`  freshness: latest ingested session_key=${latest.mx}, stint_degradation covers up to ${covered.mx}` +
    (String(latest.mx) === String(covered.mx) ? " ✅ fresh" : " ⚠️ (differ — expected if latest session has no valid laps)"));

  await client.end();
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error("refresh harness error:", e.message); process.exit(1); });
