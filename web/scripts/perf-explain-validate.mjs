#!/usr/bin/env node
import { promises as fs } from 'node:fs';

// Cost-based thresholds (round-5 unblock). Wall-clock measurements on the
// first analytic_ready session hit the OS sub-microsecond noise floor, so
// the gate metric is now Postgres planner Total Cost — deterministic,
// scale-independent, and the field the planner actually optimizes against.
const NET_P50_COST_THRESHOLD = 1.5;
const NET_P95_COST_THRESHOLD = 1.0;

const QUERY_FIELDS = ['id', 'motivation', 'indexes', 'sql', 'pre', 'post', 'speedup', 'cost_speedup'];
const PRE_POST_FIELDS = ['plan_json', 'execution_time_ms', 'total_cost'];
const AGGREGATE_FIELDS = [
  // wall-clock (diagnostic — not gated)
  'pre_p50_ms',
  'pre_p95_ms',
  'post_p50_ms',
  'post_p95_ms',
  'net_p50_speedup',
  'net_p95_speedup',
  // cost-based (gated)
  'pre_p50_cost',
  'pre_p95_cost',
  'post_p50_cost',
  'post_p95_cost',
  'net_p50_cost_speedup',
  'net_p95_cost_speedup'
];

function fail(msg) {
  process.stderr.write(`perf-explain-validate: ${msg}\n`);
  process.exit(1);
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

async function main() {
  const argPath = process.argv[2];
  if (!argPath) fail('usage: perf-explain-validate.mjs <artifact.json>');

  let raw;
  try {
    raw = await fs.readFile(argPath, 'utf8');
  } catch (err) {
    fail(`cannot read ${argPath}: ${err.message}`);
  }

  let artifact;
  try {
    artifact = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${argPath}: ${err.message}`);
  }

  if (typeof artifact.session_key !== 'number') fail('session_key missing or not a number');
  if (typeof artifact.captured_at !== 'string') fail('captured_at missing or not a string');
  if (!Array.isArray(artifact.queries)) fail('queries missing or not an array');
  if (artifact.queries.length < 10) fail(`queries length ${artifact.queries.length} < 10`);
  if (typeof artifact.aggregate !== 'object' || artifact.aggregate === null) fail('aggregate missing');
  if (!Array.isArray(artifact.regressions)) fail('regressions missing or not an array');

  for (const q of artifact.queries) {
    for (const f of QUERY_FIELDS) {
      if (!(f in q)) fail(`query ${q.id ?? '<no-id>'} missing field ${f}`);
    }
    if (typeof q.id !== 'string') fail(`query id not a string: ${JSON.stringify(q.id)}`);
    if (typeof q.motivation !== 'string') fail(`query ${q.id} motivation not a string`);
    if (!Array.isArray(q.indexes)) fail(`query ${q.id} indexes not an array`);
    if (typeof q.sql !== 'string') fail(`query ${q.id} sql not a string`);
    if (!isNumber(q.speedup)) fail(`query ${q.id} speedup not a finite number`);
    if (!isNumber(q.cost_speedup)) fail(`query ${q.id} cost_speedup not a finite number`);
    for (const phase of ['pre', 'post']) {
      const entry = q[phase];
      if (typeof entry !== 'object' || entry === null) fail(`query ${q.id} ${phase} missing`);
      for (const f of PRE_POST_FIELDS) {
        if (!(f in entry)) fail(`query ${q.id} ${phase} missing ${f}`);
      }
      if (!Array.isArray(entry.plan_json)) fail(`query ${q.id} ${phase}.plan_json not an array`);
      if (entry.plan_json.length === 0) fail(`query ${q.id} ${phase}.plan_json is empty`);
      if (!isNumber(entry.execution_time_ms)) fail(`query ${q.id} ${phase}.execution_time_ms not finite`);
      if (!isNumber(entry.total_cost)) fail(`query ${q.id} ${phase}.total_cost not finite`);
    }
  }

  for (const f of AGGREGATE_FIELDS) {
    if (!(f in artifact.aggregate)) fail(`aggregate.${f} missing`);
    if (!isNumber(artifact.aggregate[f])) fail(`aggregate.${f} not a finite number (got ${artifact.aggregate[f]})`);
  }

  if (artifact.aggregate.net_p50_cost_speedup < NET_P50_COST_THRESHOLD) {
    fail(`aggregate.net_p50_cost_speedup=${artifact.aggregate.net_p50_cost_speedup} below threshold ${NET_P50_COST_THRESHOLD}`);
  }
  if (artifact.aggregate.net_p95_cost_speedup < NET_P95_COST_THRESHOLD) {
    fail(`aggregate.net_p95_cost_speedup=${artifact.aggregate.net_p95_cost_speedup} below threshold ${NET_P95_COST_THRESHOLD} (net p95 cost regression)`);
  }
  if (artifact.regressions.length !== 0) {
    fail(`regressions array non-empty (cost-based): ${artifact.regressions.join(', ')}`);
  }

  process.stdout.write(`OK ${argPath}\n`);
  process.stdout.write(`  queries=${artifact.queries.length}\n`);
  process.stdout.write(`  aggregate.net_p50_cost_speedup=${artifact.aggregate.net_p50_cost_speedup}\n`);
  process.stdout.write(`  aggregate.net_p95_cost_speedup=${artifact.aggregate.net_p95_cost_speedup}\n`);
  process.stdout.write(`  (wall-clock diagnostic: net_p50=${artifact.aggregate.net_p50_speedup}, net_p95=${artifact.aggregate.net_p95_speedup})\n`);
}

main().catch(err => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
