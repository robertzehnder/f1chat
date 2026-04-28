#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import pg from 'pg';

const PHASE4_INDEXES = [
  'idx_raw_laps_session_include',
  'idx_raw_stints_session_driver_window',
  'idx_raw_pit_session_driver_lap',
  'idx_raw_position_history_session_date',
  'idx_raw_laps_session_driver_valid_partial'
];

const QUERIES = [
  {
    id: 'Q1',
    motivation: 'valid-lap + sector filter (full session)',
    indexes: ['idx_raw_laps_session_include'],
    sqlTemplate: `SELECT lap_duration, is_pit_out_lap, duration_sector_1, duration_sector_2, duration_sector_3 FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL`
  },
  {
    id: 'Q2',
    motivation: 'valid-lap count for one driver (partial-index path)',
    indexes: ['idx_raw_laps_session_driver_valid_partial'],
    sqlTemplate: `SELECT count(*) FROM raw.laps WHERE session_key = :s AND driver_number = 1 AND lap_duration IS NOT NULL`
  },
  {
    id: 'Q3',
    motivation: 'stint-window lookup for one driver at one lap',
    indexes: ['idx_raw_stints_session_driver_window'],
    sqlTemplate: `SELECT compound FROM raw.stints WHERE session_key = :s AND driver_number = 1 AND lap_start <= 10 AND lap_end >= 10`
  },
  {
    id: 'Q4',
    motivation: 'pit-in lookup for one driver at one lap',
    indexes: ['idx_raw_pit_session_driver_lap'],
    sqlTemplate: `SELECT * FROM raw.pit WHERE session_key = :s AND driver_number = 1 AND lap_number = 10`
  },
  {
    id: 'Q5',
    motivation: 'position-history time scan, top 100 by date',
    indexes: ['idx_raw_position_history_session_date'],
    sqlTemplate: `SELECT * FROM raw.position_history WHERE session_key = :s ORDER BY date LIMIT 100`
  },
  {
    id: 'Q6',
    motivation: 'per-driver mean lap duration (covering include index)',
    indexes: ['idx_raw_laps_session_include'],
    sqlTemplate: `SELECT driver_number, avg(lap_duration) FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL GROUP BY driver_number`
  },
  {
    id: 'Q7',
    motivation: 'per-driver compound counts across full session',
    indexes: ['idx_raw_stints_session_driver_window'],
    sqlTemplate: `SELECT driver_number, compound, count(*) FROM raw.stints WHERE session_key = :s GROUP BY driver_number, compound`
  },
  {
    id: 'Q8',
    motivation: 'per-driver pit count across full session',
    indexes: ['idx_raw_pit_session_driver_lap'],
    sqlTemplate: `SELECT driver_number, count(*) FROM raw.pit WHERE session_key = :s GROUP BY driver_number`
  },
  {
    id: 'Q9',
    motivation: 'recent 5-minute window from position history',
    indexes: ['idx_raw_position_history_session_date'],
    sqlTemplate: `SELECT date, driver_number, position FROM raw.position_history WHERE session_key = :s AND date >= (SELECT max(date) - INTERVAL '5 minutes' FROM raw.position_history WHERE session_key = :s)`
  },
  {
    id: 'Q10',
    motivation: 'per-driver median lap duration (partial-index path)',
    indexes: ['idx_raw_laps_session_driver_valid_partial'],
    sqlTemplate: `SELECT driver_number, percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL GROUP BY driver_number`
  }
];

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function percentile(sortedAsc, fraction) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.ceil(sortedAsc.length * fraction) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))];
}

function aggregateExecutionTimes(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    p50: round2(percentile(sorted, 0.5)),
    p95: round2(percentile(sorted, 0.95))
  };
}

function substituteSession(sqlTemplate, sessionKey) {
  return sqlTemplate.replace(/:s\b/g, String(sessionKey));
}

async function assertPhase4IndexesValid(client, phase) {
  const { rows } = await client.query(
    `SELECT c.relname, i.indisvalid
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'raw' AND c.relname = ANY($1::text[])`,
    [PHASE4_INDEXES]
  );
  const byName = new Map(rows.map(r => [r.relname, r.indisvalid]));
  const missing = PHASE4_INDEXES.filter(n => !byName.has(n));
  const invalid = PHASE4_INDEXES.filter(n => byName.has(n) && byName.get(n) !== true);
  if (missing.length || invalid.length) {
    throw new Error(`Phase 4 index validity check failed (${phase}): missing=[${missing.join(',')}] invalid=[${invalid.join(',')}]`);
  }
}

const EXPLAIN_WARMUP_RUNS = 2;
const EXPLAIN_MEASURED_RUNS = 11;

async function captureExplainOnce(client, sql) {
  const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const planJson = rows[0]['QUERY PLAN'];
  const top = planJson[0];
  return {
    plan_json: planJson,
    execution_time_ms: top['Execution Time'],
    total_cost: top.Plan['Total Cost']
  };
}

async function captureExplain(client, sql) {
  for (let i = 0; i < EXPLAIN_WARMUP_RUNS; i++) {
    await captureExplainOnce(client, sql);
  }
  const runs = [];
  for (let i = 0; i < EXPLAIN_MEASURED_RUNS; i++) {
    runs.push(await captureExplainOnce(client, sql));
  }
  runs.sort((a, b) => a.execution_time_ms - b.execution_time_ms);
  return runs[Math.floor(runs.length / 2)];
}

async function captureAll(client, sessionKey, label) {
  const out = {};
  for (const q of QUERIES) {
    const sql = substituteSession(q.sqlTemplate, sessionKey);
    process.stderr.write(`[${label}] ${q.id}…`);
    const result = await captureExplain(client, sql);
    process.stderr.write(` ${result.execution_time_ms.toFixed(2)}ms\n`);
    out[q.id] = result;
  }
  return out;
}

async function dropPhase4Indexes(client) {
  for (const name of PHASE4_INDEXES) {
    process.stderr.write(`DROP INDEX CONCURRENTLY IF EXISTS raw.${name}…\n`);
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS raw.${name}`);
  }
}

function reapplyMigration(repoRoot, databaseUrl) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', 'sql/020_perf_indexes.sql'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (result.error) {
    throw new Error(`psql spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`psql re-apply of sql/020_perf_indexes.sql exited ${result.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.output) {
    throw new Error('--output=<path> is required');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
  const outputPath = path.isAbsolute(args.output) ? args.output : path.resolve(process.cwd(), args.output);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  let aborted = false;
  let droppedYet = false;
  try {
    const { rows: sessRows } = await client.query(
      `SELECT session_key FROM core.session_completeness WHERE completeness_status = 'analytic_ready' ORDER BY session_key ASC LIMIT 1`
    );
    if (sessRows.length === 0 || sessRows[0].session_key === null) {
      throw new Error('no analytic_ready session available in core.session_completeness');
    }
    const sessionKey = Number(sessRows[0].session_key);
    process.stderr.write(`session_key = ${sessionKey}\n`);

    await assertPhase4IndexesValid(client, 'pre-run');

    const post = await captureAll(client, sessionKey, 'POST');

    droppedYet = true;
    await dropPhase4Indexes(client);

    const pre = await captureAll(client, sessionKey, 'PRE');

    process.stderr.write('Re-applying sql/020_perf_indexes.sql…\n');
    reapplyMigration(repoRoot, databaseUrl);
    droppedYet = false;

    await assertPhase4IndexesValid(client, 'post-reapply');

    const queries = QUERIES.map(q => {
      const preEntry = pre[q.id];
      const postEntry = post[q.id];
      // Cost-based speedup is the primary correctness signal. Wall-clock
      // speedup is retained for diagnostic but not used for thresholds —
      // sub-microsecond queries on small `analytic_ready` sessions hit the
      // OS noise floor and produce non-deterministic ratios that mask the
      // real cost-model improvement (round-5 unblock; see slice file).
      const speedup = preEntry.execution_time_ms / postEntry.execution_time_ms;
      const cost_speedup = preEntry.total_cost / postEntry.total_cost;
      return {
        id: q.id,
        motivation: q.motivation,
        indexes: q.indexes,
        sql: substituteSession(q.sqlTemplate, sessionKey),
        pre: preEntry,
        post: postEntry,
        speedup: round2(speedup),
        cost_speedup: round2(cost_speedup)
      };
    });

    const preTimes = QUERIES.map(q => pre[q.id].execution_time_ms);
    const postTimes = QUERIES.map(q => post[q.id].execution_time_ms);
    const preCosts = QUERIES.map(q => pre[q.id].total_cost);
    const postCosts = QUERIES.map(q => post[q.id].total_cost);
    const preAgg = aggregateExecutionTimes(preTimes);
    const postAgg = aggregateExecutionTimes(postTimes);
    const preCostAgg = aggregateExecutionTimes(preCosts);
    const postCostAgg = aggregateExecutionTimes(postCosts);
    const aggregate = {
      // Wall-clock (diagnostic only — not gated; see cost_* fields).
      pre_p50_ms: preAgg.p50,
      pre_p95_ms: preAgg.p95,
      post_p50_ms: postAgg.p50,
      post_p95_ms: postAgg.p95,
      net_p50_speedup: round2(preAgg.p50 / postAgg.p50),
      net_p95_speedup: round2(preAgg.p95 / postAgg.p95),
      // Cost-based (deterministic, gated by the validator).
      pre_p50_cost: preCostAgg.p50,
      pre_p95_cost: preCostAgg.p95,
      post_p50_cost: postCostAgg.p50,
      post_p95_cost: postCostAgg.p95,
      net_p50_cost_speedup: round2(preCostAgg.p50 / postCostAgg.p50),
      net_p95_cost_speedup: round2(preCostAgg.p95 / postCostAgg.p95)
    };

    const regressions = queries
      .filter(q => q.cost_speedup < 1 / 1.2)
      .map(q => q.id);

    const artifact = {
      session_key: sessionKey,
      captured_at: new Date().toISOString(),
      queries,
      aggregate,
      regressions
    };

    await fs.writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    process.stderr.write(`wrote ${outputPath}\n`);
  } catch (err) {
    aborted = true;
    if (droppedYet) {
      process.stderr.write(`ERROR after drop, before re-apply: ${err.message}\n`);
      process.stderr.write(`Indexes are NOT yet restored. Run the safety re-apply gate manually:\n`);
      process.stderr.write(`  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql\n`);
    } else {
      process.stderr.write(`ERROR: ${err.message}\n`);
    }
    throw err;
  } finally {
    await client.end();
  }

  if (aborted) process.exit(1);
}

main().catch(err => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
