---
slice_id: 04-explain-before-after
phase: 4
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T18:50:00Z
---

## Goal
Capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for a deterministic set of 10 representative queries before and after the Phase 4 indexes (`sql/020_perf_indexes.sql`) are present on the live DB. Persist both plans plus per-query and aggregate p50/p95 deltas into a versioned artifact. The sibling slice `04-perf-indexes-sql` is `done`, so the indexes are already in place; this slice obtains the pre-index state by dropping the five Phase 4 indexes, capturing the pre-state plans, then re-applying `sql/020_perf_indexes.sql` and asserting `pg_index.indisvalid = true` before the post-state capture and artifact validation.

## Decisions
- **Pre-index state via temporary drop, not a snapshot DB.** `04-perf-indexes-sql` has merged, so the live DB no longer has a "no Phase 4 indexes" state on disk. The cleanest reproducible alternative is to (a) capture POST plans first against the current state, (b) `DROP INDEX CONCURRENTLY IF EXISTS` each of the five Phase 4 indexes, (c) capture PRE plans, (d) re-apply `sql/020_perf_indexes.sql` (idempotent — `IF NOT EXISTS`), (e) re-assert `pg_index.indisvalid = true` for every Phase 4 index. `DROP INDEX CONCURRENTLY` cannot run inside an explicit transaction block (same constraint that drove the migration shape in the sibling), so the helper issues each drop as its own statement under `ON_ERROR_STOP=1`. Recovery if the helper aborts between drop and re-apply: rerun gate #4 (`psql -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql`) followed by gate #5 to restore validity.
- **Capture POST first, then PRE.** Capturing POST first means the indexes are valid for the bulk of the run; the window where the DB has no Phase 4 indexes is bounded by the 10 PRE EXPLAINs and immediately followed by the re-apply.
- **Top-10 query list is enumerated inline, not derived from the rollup at runtime.** The Goal's reference to "per `01-perf-summary-route` rollup" identified the *motivation* for picking these queries (they cover the slowest stages — `execute_db`, `resolve_db`, `runtime_classify` — from `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json`), but the rollup keys on chatRuntime stage names, not on individual SQL bodies, so it cannot programmatically yield the top-10 query list. Steps §1 enumerates the exact 10 query templates with parameter placeholders; the helper substitutes the deterministic `analytic_ready` session key (same selector as the sibling slice) and runs each query verbatim. This makes the slice fully reproducible and removes any ambiguity about which queries are measured.
- **`sql/020_perf_indexes.sql` (not `sql/perf_indexes.sql`).** Rename inherited from the sibling slice's actual filename.
- **Helper is a plain `.mjs` node script, no TypeScript.** Same precedent as `web/scripts/perf-explain-*` — runs under `node` directly with no build step. It connects via `pg` (already in `web/package.json`).
- **Both p50 and p95 deltas are required and gated.** The Goal calls for both; the artifact MUST include them, and gate #6 fails if either is missing.

## Inputs
- `sql/020_perf_indexes.sql` — the Phase 4 index migration (drop targets and re-apply source).
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` — the existing baseline rollup (the `01-perf-summary-route` output). Used to motivate the top-10 query list (slowest stages) and to cross-check that the queries in Steps §1 cover those stages' access patterns.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/04-perf-indexes-sql.md` — the sibling slice's index list, naming conventions, deterministic-session selector, and `pg_index.indisvalid` validity-assertion pattern that this slice reuses verbatim.
- `diagnostic/slices/01-perf-summary-route.md` — defines the rollup that motivates the top-10 query selection in Steps §1.

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role must own the `raw.*` tables (or be a member of the owning role, or have `MAINTAIN` on PG ≥ 17) to `DROP` and `CREATE` indexes — same prerequisite as the sibling slice. Schema-level `CREATE` on `raw` is not sufficient on its own.
- `SELECT` on `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history`, and `core.session_completeness` (for `EXPLAIN ANALYZE` to plan and execute the queries; `ANALYZE` runs the queries for real timings).
- `psql` available on `PATH`.
- `node` ≥ 20 available on `PATH` (for the helper script).
- `npm --prefix web ci` (or already-installed `web/node_modules`) so that `pg` resolves when the helper runs from the worktree root via `node --experimental-resolve-json-module web/scripts/perf-explain-before-after.mjs`. The helper imports `pg` via `from '../../web/node_modules/pg/lib/index.js'` is brittle; it instead uses `import('pg')` resolved relative to `web/` by spawning the helper with `cwd: web/` (see Steps §3).
- **Drop/recreate window.** Between Steps §3.b and §3.d the live DB has no Phase 4 indexes. This is intentional and bounded; the helper holds the window only long enough to run 10 EXPLAIN ANALYZE statements (single-digit seconds against `analytic_ready` data). If the helper aborts, gate #4 re-applies the migration.
- **Drop ordering and constraint.** `DROP INDEX CONCURRENTLY` cannot run inside an explicit transaction block; the helper issues each drop as a standalone statement under `ON_ERROR_STOP=1`. `IF EXISTS` on each drop makes the step idempotent (re-running after a partial failure does not error).

## Steps
1. **Enumerate the 10 EXPLAIN-target queries** in the helper as a constant array. Each entry: `{ id, motivation, indexes, sql }`. The 10 queries cover all five Phase 4 indexes plus four orthogonal access patterns drawn from the slowest stages in `01-baseline-snapshot_2026-04-26.json` (the `execute_db` and `resolve_db` stages dominate, both of which run against `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history`). All queries use `:s` as a placeholder for the deterministic session key (Steps §3.a). Literal `driver_number = 1` and `lap_number = 10` are used where the access pattern requires bound parameters; the planner ignores row-presence for cost estimation, and `ANALYZE` will execute against actual data and report real timings:
   - `Q1` (idx_raw_laps_session_include): `SELECT lap_duration, is_pit_out_lap, duration_sector_1, duration_sector_2, duration_sector_3 FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL`
   - `Q2` (idx_raw_laps_session_driver_valid_partial): `SELECT count(*) FROM raw.laps WHERE session_key = :s AND driver_number = 1 AND lap_duration IS NOT NULL`
   - `Q3` (idx_raw_stints_session_driver_window): `SELECT compound FROM raw.stints WHERE session_key = :s AND driver_number = 1 AND lap_start <= 10 AND lap_end >= 10`
   - `Q4` (idx_raw_pit_session_driver_lap): `SELECT * FROM raw.pit WHERE session_key = :s AND driver_number = 1 AND lap_number = 10`
   - `Q5` (idx_raw_position_history_session_date): `SELECT * FROM raw.position_history WHERE session_key = :s ORDER BY date LIMIT 100`
   - `Q6` (idx_raw_laps_session_include, distinct shape from Q1): `SELECT driver_number, avg(lap_duration) FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL GROUP BY driver_number`
   - `Q7` (idx_raw_stints_session_driver_window — full-session scan): `SELECT driver_number, compound, count(*) FROM raw.stints WHERE session_key = :s GROUP BY driver_number, compound`
   - `Q8` (idx_raw_pit_session_driver_lap — full-session scan): `SELECT driver_number, count(*) FROM raw.pit WHERE session_key = :s GROUP BY driver_number`
   - `Q9` (idx_raw_position_history_session_date — recent slice): `SELECT date, driver_number, position FROM raw.position_history WHERE session_key = :s AND date >= (SELECT max(date) - INTERVAL '5 minutes' FROM raw.position_history WHERE session_key = :s)`
   - `Q10` (idx_raw_laps_session_driver_valid_partial — multi-driver aggregate): `SELECT driver_number, percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) FROM raw.laps WHERE session_key = :s AND lap_duration IS NOT NULL GROUP BY driver_number`
2. **Author `web/scripts/perf-explain-before-after.mjs`** as a plain `.mjs` node script that:
   - Imports `pg` (resolved from `web/node_modules`).
   - Resolves the deterministic session: `SELECT session_key FROM core.session_completeness WHERE completeness_status = 'analytic_ready' ORDER BY session_key ASC LIMIT 1`. Fails with non-zero exit if NULL.
   - Verifies all 5 Phase 4 indexes exist and are valid via the same `pg_index.indisvalid` check used in the sibling slice's gate #2; aborts if any are missing/invalid.
   - **POST capture**: for each of Q1–Q10, runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` with `:s` substituted; parses the JSON plan; records `plan_json` (the array Postgres returns), `execution_time_ms` (from the plan's `Execution Time`), and `total_cost` (from the plan's `Plan.Total Cost`). Stores under `post[<id>]`.
   - **DROP step**: issues five `DROP INDEX CONCURRENTLY IF EXISTS raw.<name>;` statements (one per Phase 4 index), each as its own `client.query()` call (no transaction wrapper).
   - **PRE capture**: same as POST, but stored under `pre[<id>]`.
   - **Re-apply step**: invokes `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql` via `child_process.spawnSync`. Because gate #2 invokes the helper from `web/` (i.e. process CWD is `web/`), the helper MUST explicitly compute the worktree-root path and pass it as `spawnSync`'s `cwd` option so the relative `sql/020_perf_indexes.sql` resolves correctly. Concretely: `const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');` (one level up from `web/scripts/` to `web/`, then one more to the worktree root) and pass `{ cwd: repoRoot, stdio: 'inherit' }` to `spawnSync`. Aborts non-zero if `status !== 0`.
   - **Re-validate**: re-runs the `pg_index.indisvalid` check; aborts if any of the five are missing or invalid after re-apply.
   - **Compute deltas**: for each Q, `speedup = pre.execution_time_ms / post.execution_time_ms`; records per-query speedup. Aggregates `pre_p50_ms`, `pre_p95_ms`, `post_p50_ms`, `post_p95_ms` (nearest-rank ceiling, sorted ascending, rounded to 2 decimals — same algorithm as `web/src/lib/perfSummary.mjs`) across the 10 `execution_time_ms` values per phase. Computes `net_p50_speedup = pre_p50_ms / post_p50_ms` and `net_p95_speedup = pre_p95_ms / post_p95_ms`.
   - **Flag regressions**: marks any `Q` with `speedup < 1 / 1.2` (i.e. >1.2× slower post-index) into a top-level `regressions: []` array.
   - **Write artifact** to the path passed via `--output=<path>` (created via `fs.promises.writeFile`, JSON-pretty 2-space). The artifact shape is documented under "Artifact paths" below.
3. **Author `web/scripts/perf-explain-validate.mjs`** — a plain `.mjs` node script that takes the artifact path and asserts BOTH shape AND numeric thresholds. It exits non-zero with a clear diagnostic on any failure. The validator MUST assert all of the following (gate #6 fails if any check fails):
   - **Shape**: presence of `session_key` (number), `captured_at` (ISO string), `queries` (array of length ≥10), `aggregate` object, and `regressions` (array). Each query entry must carry `id`, `motivation`, `indexes`, `sql`, `pre.plan_json`, `pre.execution_time_ms`, `pre.total_cost`, `post.plan_json`, `post.execution_time_ms`, `post.total_cost`, and per-query `speedup`. The `aggregate` block must contain numeric (non-null, non-NaN) `pre_p50_ms`, `pre_p95_ms`, `post_p50_ms`, `post_p95_ms`, `net_p50_speedup`, `net_p95_speedup`.
   - **Threshold: `aggregate.net_p50_speedup ≥ 1.5`** — fails non-zero with diagnostic `aggregate.net_p50_speedup=<value> below threshold 1.5` if not satisfied.
   - **Threshold: `aggregate.net_p95_speedup ≥ 1.0`** — fails non-zero with diagnostic `aggregate.net_p95_speedup=<value> below threshold 1.0 (net p95 regression)` if not satisfied.
   - **Regressions empty: `regressions.length === 0`** — fails non-zero with diagnostic listing the offending query IDs if not satisfied.

   This decouples shape and threshold validation from the capture run so a re-validate after edits doesn't require touching the DB. Asserting thresholds in the validator (not only documenting them in acceptance criteria) is what makes acceptance criteria for the three numeric/array gates testable via gate #6.
4. **Run gate commands** (see "Gate commands" below) to: (#0) refresh `web/node_modules` if needed, (#1) verify pre-state validity, (#2) execute the helper, (#3) confirm the artifact exists, (#4) re-apply the migration as a safety net (idempotent), (#5) re-assert validity, (#6) validate artifact shape.
5. **Capture command outputs into the slice-completion note** — including the artifact's `aggregate` block and the `regressions` array.

## Changed files expected
Files the implementer will add or edit during this slice:
- `web/scripts/perf-explain-before-after.mjs` — new (~250 LOC). Connects via `pg`, runs the POST/DROP/PRE/RE-APPLY/RE-VALIDATE flow, writes the artifact.
- `web/scripts/perf-explain-validate.mjs` — new (~80 LOC). Pure shape validator over the artifact JSON.
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` — new. Versioned artifact (date in filename matches the implementer's run date; if the run lands on a different date, the implementer adjusts the filename in this Steps section, the gate commands, and the slice-completion note).
- `diagnostic/slices/04-explain-before-after.md` — this slice file (frontmatter status/owner/timestamp + slice-completion note + ticking previously-addressed verdict checkboxes; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).
- `diagnostic/_state.md` — **conditionally permitted only when an auditor appends a `[state-note]` commit** (the loop's auditor role prompt allows this; the sibling slice `04-perf-indexes-sql` handled the same case). The implementer does not edit `_state.md`; if it appears in the branch diff, it must be an auditor-authored line under "Notes for auditors". The acceptance-criteria diff-check accepts this exact path as an additional allowed entry.

No edits to `sql/*.sql`, application code under `web/src/`, or any other slice file.

## Artifact paths
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-28.json` (date in filename adjusted to the actual run date by the implementer if different).

Artifact shape (asserted by `perf-explain-validate.mjs`):
```jsonc
{
  "session_key": <bigint>,
  "captured_at": "<ISO-8601>",
  "queries": [
    {
      "id": "Q1",
      "motivation": "<one-line>",
      "indexes": ["idx_raw_laps_session_include"],
      "sql": "<verbatim SQL with :s substituted>",
      "pre": {
        "plan_json": <array from EXPLAIN FORMAT JSON>,
        "execution_time_ms": <number>,
        "total_cost": <number>
      },
      "post": { /* same shape */ },
      "speedup": <number>  // pre.execution_time_ms / post.execution_time_ms
    },
    /* …Q2–Q10… */
  ],
  "aggregate": {
    "pre_p50_ms": <number>,
    "pre_p95_ms": <number>,
    "post_p50_ms": <number>,
    "post_p95_ms": <number>,
    "net_p50_speedup": <number>,
    "net_p95_speedup": <number>
  },
  "regressions": [<query ids with speedup < 1/1.2>]
}
```

## Gate commands
```bash
set -euo pipefail

# 0. Ensure web/node_modules is present so the helper can resolve `pg`.
[ -d web/node_modules ] || npm --prefix web ci

# 1. Pre-state validity check (the five Phase 4 indexes must exist and be valid
#    before we start, since the sibling slice has merged). Same DO-block as the
#    sibling's gate #2.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  expected text[] := ARRAY[
    'idx_raw_laps_session_include',
    'idx_raw_stints_session_driver_window',
    'idx_raw_pit_session_driver_lap',
    'idx_raw_position_history_session_date',
    'idx_raw_laps_session_driver_valid_partial'
  ];
  idx text;
  is_valid bool;
BEGIN
  FOREACH idx IN ARRAY expected LOOP
    SELECT i.indisvalid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'raw' AND c.relname = idx
    INTO is_valid;
    IF is_valid IS NULL THEN
      RAISE EXCEPTION 'expected index raw.% missing pre-run; sibling slice 04-perf-indexes-sql may not be applied', idx;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'expected index raw.% INVALID pre-run; drop and re-create with CREATE INDEX CONCURRENTLY before retry', idx;
    END IF;
  END LOOP;
END $$;
SQL

# 2. Run the EXPLAIN-before-after helper. Internally captures POST, DROPs the
#    five indexes, captures PRE, re-applies sql/020_perf_indexes.sql, re-asserts
#    indisvalid, computes deltas, writes the artifact.
ARTIFACT="diagnostic/artifacts/perf/04-explain-before-after_$(date +%Y-%m-%d).json"
( cd web && node scripts/perf-explain-before-after.mjs --output="../$ARTIFACT" )

# 3. Confirm the artifact landed at the expected path.
test -f "$ARTIFACT"

# 4. Safety re-apply: idempotent because every CREATE INDEX uses IF NOT EXISTS.
#    A no-op on the happy path; a recovery if the helper aborted between drop
#    and its own re-apply step.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql

# 5. Re-assert post-run validity (same DO-block as gate #1).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  expected text[] := ARRAY[
    'idx_raw_laps_session_include',
    'idx_raw_stints_session_driver_window',
    'idx_raw_pit_session_driver_lap',
    'idx_raw_position_history_session_date',
    'idx_raw_laps_session_driver_valid_partial'
  ];
  idx text;
  is_valid bool;
BEGIN
  FOREACH idx IN ARRAY expected LOOP
    SELECT i.indisvalid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'raw' AND c.relname = idx
    INTO is_valid;
    IF is_valid IS NULL THEN
      RAISE EXCEPTION 'expected index raw.% missing post-run; helper or re-apply failed', idx;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'expected index raw.% INVALID post-run; manual DROP+CREATE required', idx;
    END IF;
  END LOOP;
END $$;
SQL

# 6. Validate artifact shape: ≥10 queries with both pre/post plan_json,
#    aggregate p50/p95 for both phases, both net speedups, and a regressions
#    array. Fails non-zero with a clear diagnostic on any missing field.
node web/scripts/perf-explain-validate.mjs "$ARTIFACT"
```

## Acceptance criteria
- [ ] `web/scripts/perf-explain-before-after.mjs` exists and runs to completion under gate #2 against `DATABASE_URL`, writing the artifact under `diagnostic/artifacts/perf/04-explain-before-after_<date>.json`.
- [ ] `web/scripts/perf-explain-validate.mjs` exists and exits `0` for the produced artifact under gate #6.
- [ ] Gate #1 (pre-state validity) exits `0` — the sibling slice's indexes are present at run start.
- [ ] Gate #5 (post-run validity) exits `0` — all five Phase 4 indexes are valid after the helper completes.
- [ ] Artifact contains pre/post `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for **all 10** queries (Q1–Q10), each with `pre.plan_json`, `pre.execution_time_ms`, `post.plan_json`, `post.execution_time_ms`, and per-query `speedup`. Validated by gate #6.
- [ ] Artifact `aggregate` block contains `pre_p50_ms`, `pre_p95_ms`, `post_p50_ms`, `post_p95_ms`, `net_p50_speedup`, `net_p95_speedup` — all numeric, no `null`. Validated by gate #6.
- [ ] `aggregate.net_p50_speedup ≥ 1.5`. Validated by gate #6 (the validator reads the artifact and asserts the threshold).
- [ ] `aggregate.net_p95_speedup ≥ 1.0` (no net regression at p95). Validated by gate #6.
- [ ] `regressions` array is empty (no per-query regression > 1.2× slower post-index). Validated by gate #6.
- [ ] The set of files modified by this branch versus `integration/perf-roadmap` is a subset of `web/scripts/perf-explain-before-after.mjs` (new), `web/scripts/perf-explain-validate.mjs` (new), `diagnostic/artifacts/perf/04-explain-before-after_<date>.json` (new), `diagnostic/slices/04-explain-before-after.md` (this slice file), and `diagnostic/_state.md` (only if an auditor appended a `[state-note]` commit). Verified via `git diff --name-only integration/perf-roadmap...HEAD`. The first four files MUST appear; `diagnostic/_state.md` is permitted but optional.

## Out of scope
- Editing `sql/020_perf_indexes.sql` or any other migration. The drop here is a transient runtime operation, not a schema change.
- Re-running the chat health-check benchmark (`web/scripts/chat-health-check.mjs`). This slice measures EXPLAIN-level deltas only; end-to-end benchmark deltas belong to a future Phase 4 / Phase 5 slice.
- Modifying any application code (`web/src/**`).
- Adding new indexes, dropping non-Phase-4 indexes, or changing index ownership.
- Generating a per-stage rollup over the artifact (the rollup-vs-stage mapping is documented in Decisions; deriving stage-level deltas from per-query EXPLAIN timings is out of scope).

## Risk / rollback
- **Risk: helper aborts between drop and re-apply.** Mitigation: gate #4 unconditionally re-applies `sql/020_perf_indexes.sql` (idempotent — `IF NOT EXISTS`); gate #5 re-asserts `indisvalid = true` for every Phase 4 index. If gate #4 also fails, manual recovery is `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql` followed by `DROP INDEX CONCURRENTLY raw.<name>;` for any index that ended up `INVALID`.
- **Risk: drop window blocks concurrent queries.** `DROP INDEX CONCURRENTLY` waits for in-flight transactions on the table but does not block new readers/writers; the bounded ~single-digit-seconds drop window is acceptable for a Neon dev branch. If the slice is replayed against production, gate #2's drop must be coordinated with traffic.
- **Risk: `analytic_ready` session changes between PRE and POST capture.** The helper resolves the session ONCE at startup and uses the same `:s` value for all 10 PRE and 10 POST EXPLAINs, so the access pattern, predicate selectivity, and table cardinalities are stable across phases.
- **Risk: `core.session_completeness` is empty or has no `analytic_ready` sessions.** Same `RAISE EXCEPTION` branch the sibling slice uses; helper aborts non-zero with a clear diagnostic before any drop.
- **Risk: `aggregate.net_p50_speedup < 1.5`.** The acceptance criteria requires ≥1.5×. If the actual speedup is below threshold, the slice is BLOCKED and the implementer must (a) confirm the sibling indexes are valid (gates #1, #5), (b) confirm the deterministic session has enough rows for `EXPLAIN ANALYZE` to be representative, and (c) escalate to user with the artifact for review rather than ship a regression.
- **Rollback**: `git revert <commit>` removes the helper scripts and the artifact. The DB state is left unchanged (the indexes are restored by gate #4 / gate #5 regardless of revert).

## Slice-completion note
(filled by Claude)

## Audit verdict

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Specify how the implementer obtains both the pre-index and post-index plans, including whether this slice runs against two DB states/snapshots or temporarily drops and reapplies the Phase 4 indexes; the current Steps assume a pre-index state that no longer exists once `04-perf-indexes-sql` has landed.
- [x] Replace the unrelated `web` gate commands with DB/artifact gates that actually execute this slice's workflow and prove the acceptance criteria from the generated artifact; `build`, `typecheck`, and `test:grading` do not validate top-10 query selection, pre/post EXPLAIN capture, or delta computation.

### Medium
- [x] Rename the Phase 4 index input from `sql/perf_indexes.sql` to `sql/020_perf_indexes.sql` so this slice matches the merged sibling `04-perf-indexes-sql` plan and the actual migration filename.
- [x] Add the `01-perf-summary-route` rollup artifact to Inputs/Prior context, or change the Goal/Steps to name the baseline artifact actually used to rank the top 10 slowest queries; the current slice says the ranking comes from the rollup but points only at `01-baseline-snapshot-v2_2026-04-26.json`.
- [x] Make the acceptance criteria fully testable and internally consistent by specifying where both p50 and p95 deltas are recorded and by adding a gate that asserts those fields in the output artifact; the current criteria require a p50 threshold only even though the Goal says to document p50/p95 deltas.
- [x] Expand `Changed files expected` to include the slice file itself and any helper script or SQL artifact the implementer must add if artifact generation is not purely manual; the current list only names the JSON artifact.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on `2026-04-28T11:30:14Z`, so no stale-state note is required this round.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — genuine High and Medium items found)**

### High
- [x] Steps §2's `spawnSync` call for `psql -f sql/020_perf_indexes.sql` will fail at runtime: gate #2 invokes the helper as `( cd web && node scripts/perf-explain-before-after.mjs ... )`, so the Node process CWD is `web/`, which makes the relative path `sql/020_perf_indexes.sql` resolve to `web/sql/020_perf_indexes.sql` — a non-existent path. Steps §2 must specify that the `spawnSync` call explicitly sets `cwd` to the repo root (e.g., `path.resolve(new URL('.', import.meta.url).pathname, '..')` to go one level up from `web/scripts/`) so that `sql/020_perf_indexes.sql` resolves correctly against the worktree root.

### Medium
- [x] Steps §3 says the validate script "asserts the shape (presence of …)" but three acceptance criteria are attributed to gate #6: `aggregate.net_p50_speedup ≥ 1.5`, `aggregate.net_p95_speedup ≥ 1.0`, and `regressions` array empty. Steps §3 must explicitly state the validator also asserts these numeric thresholds and array-emptiness check — not merely field presence — so the implementer does not write a shape-only validator that lets a sub-threshold artifact pass gate #6.

### Low
- [x] `## Changed files expected` and the acceptance criteria diff-check enumerate exactly 4 files with no provision for `diagnostic/_state.md`. If any auditor appends a `[state-note]` commit to this branch (permitted by the loop's auditor role prompt), that file appears in the diff and the diff-check acceptance criterion fails. Consider adding `diagnostic/_state.md` as a conditionally expected file (auditor-note commits only), matching the pattern the sibling slice `04-perf-indexes-sql` used to handle the same situation.

### Notes (informational only — no action)
- Round-1 items are all ticked `[x]` in the round-1 verdict block; each is substantively addressed in the revised plan body.
- `diagnostic/_state.md` is still current (2026-04-28T11:30:14Z); no stale-state note needed.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
_None._

### Medium
_None._

### Low
- [ ] The Goal paragraph describes the PRE/POST capture order as: drop → capture pre → re-apply → assert validity → post capture. The Decisions section and Steps §2 explicitly specify the opposite (POST first, then DROP, then PRE). The Goal paragraph's loose wording is misleading; consider aligning it with the Decisions section's "Capture POST first, then PRE" order to avoid confusion on re-read. Does not block implementation since Decisions and Steps are internally consistent and authoritative.

### Notes (informational only — no action)
- Round-2 High item (spawnSync cwd bug) is substantively addressed: Steps §2 now specifies `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')` with `{ cwd: repoRoot }` passed to spawnSync.
- Round-2 Medium item (validator threshold gap) is substantively addressed: Steps §3 now explicitly enumerates the three numeric/array threshold checks the validator must assert.
- Round-2 Low item (`diagnostic/_state.md` in diff-check) is substantively addressed: both `## Changed files expected` and the acceptance criteria diff-check now include `diagnostic/_state.md` as a conditional auditor-note entry.
- No generic protocol lesson warrants a `[state-note]` append to `_state.md` this round.
