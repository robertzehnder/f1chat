# Phase 18 — Phase 17 Follow-ups Plan — 2026-05-02 (rev5. 2026-05-02 post-audit-5)

## Revision 5 (2026-05-02 post-audit-5)

A fifth audit caught one low-severity issue in the RAISE EXCEPTION
format string. PL/pgSQL `RAISE` uses `%` as the placeholder; `%s` is
printf-style and would render as a `%`-substitution followed by a
literal `s`. Rev5 collapses to a single `%` placeholder and folds the
newline into `bad_summary` (which already contains newlines from the
`string_agg(..., E'\n')` call):

```sql
RAISE EXCEPTION
  '028: core.session_completeness_data column shape diverges from canonical 005 projection (% mismatches): %',
  bad_count, bad_summary;
```

No open questions remain at rev5.



## Revision 4 (2026-05-02 post-audit-4)

A fourth audit caught three issues in slice C's column-shape verify
block, no high-severity findings outside slice C:

1. **High — `NORMALIZE()` is not a Postgres function.** rev3's verify
   used `NORMALIZE(actual) IS DISTINCT FROM NORMALIZE(...)`, which
   would error at deploy time with `function normalize(text) does not
   exist`. Rev4 replaces with executable SQL: a CTE listing the
   expected `(attnum, attname, atttype)` triples joined against
   `pg_attribute`, with a `FULL OUTER JOIN` that surfaces any
   missing/extra/divergent rows. No exotic functions, no string-
   manipulation tricks; just two relations and a join.
2. **High — expected column list was materially incomplete.** rev3
   stopped around `starting_grid_rows` (24 columns) but the actual
   `core.session_completeness` projection is 45 columns including
   `race_control_rows`, `overtakes_rows`, the full set of `has_*`
   booleans, `completeness_score`, `meeting_name`,
   `normalized_session_type`, `completeness_status`, etc. Verified
   on Neon via `pg_attribute` 2026-05-02. Rev4 inlines the full 45-
   column authoritative list as the verify CTE rather than calling
   it "illustrative", so the migration body is land-ready.
3. **Medium — wrong introspection function in the regen note.** rev3
   said "regenerate by running through `pg_get_indexdef`", but
   `pg_get_indexdef` returns the index definition, not the projection
   columns. Plus `information_schema.columns` doesn't list matview
   columns at all (it enumerates regular tables and views only;
   tested 2026-05-02 — empty result for the matview). Rev4 corrects
   the regen instruction: use `pg_attribute` joined to `pg_class` /
   `pg_namespace` for the matview's column metadata after CREATE,
   and `pg_get_viewdef` only for capturing the source SQL body of
   the original 005 view.

No open questions remain at rev4.



## Revision 3 (2026-05-02 post-audit-3)

A third audit caught three issues in slice C, no high severity:

1. **Medium — Python refresh script needs autocommit.** rev2's
   `scripts/refresh_completeness_matview.py` fires
   `REFRESH MATERIALIZED VIEW CONCURRENTLY core.session_completeness_data`,
   but psycopg2 opens an implicit transaction block by default and
   `REFRESH ... CONCURRENTLY` is rejected inside one with `cannot run
   inside a transaction block`. (`scripts/ingest.mjs` using `psql -c`
   is fine because psql runs each `-c` command in autocommit.) Rev3
   spec explicitly requires `conn.autocommit = True` before the
   refresh in the Python script.
2. **Medium — `CREATE MATERIALIZED VIEW IF NOT EXISTS` can mask a
   wrong-shaped pre-existing matview.** rev2's idempotence guard skips
   creation if a relation with the same name exists, but a partial
   prior deploy could have left the matview with a different column
   set/order/types. The migration's relkind verify wouldn't catch
   that — only a downstream `SELECT * FROM session_completeness_data`
   join would error at use time. Rev3 adds a column-shape verify gate
   (names + ordinal positions + types) against the canonical 005
   projection; if the existing matview's shape doesn't match, the
   migration `RAISE EXCEPTION`s loudly so an operator can investigate
   rather than silently retain stale shape.
3. **Low — "return at least one row" smoke gate is data-dependent.**
   Useful on the audited Neon DB; brittle on empty/dev branches.
   Rev3 splits into two layers:
   - `LIMIT 0` compile/schema checks in the migration verify and the
     `phase17_neon_setup.py` acceptance — runs anywhere, validates
     the views compile and select clean.
   - Row-count checks (`> 0` for matview, `> 0` for at least one
     dependent) move into a separate "neon-data smoke" block that
     only runs when `OPENF1_ASSUME_POPULATED=1` (or by default on
     `NEON_DATABASE_URL`-class hosts; opt-out for empty test
     branches).

No open questions remain at rev3.



## Revision 2 (2026-05-02 post-audit-2)

A second audit caught four issues:

1. **High — Slice C still misses `core.source_anomaly_tracking`.** rev1
   recreated `weekend_session_coverage` and
   `weekend_session_expectation_audit` after `DROP ... CASCADE`, but
   `core.source_anomaly_tracking` (`005_helper_tables.sql:845`) also
   depends on `session_completeness` directly and via
   `weekend_session_expectation_audit`. Verified on Neon today:
   `pg_depend` returns `source_anomaly_tracking` as a dependent. A
   CASCADE drop on rev1's plan would silently remove it. Rev2 switches
   the migration to `CREATE OR REPLACE VIEW core.session_completeness
   AS SELECT * FROM core.session_completeness_data` on the
   fresh-branch path so no CASCADE is needed at all. The Phase-17
   artifact path (relkind='m' on Neon) explicitly enumerates and
   recreates ALL three dependents from `pg_depend`.
2. **High — rev1 migration not idempotent.** rev1 ran
   `CREATE MATERIALIZED VIEW core.session_completeness_data AS ...`
   and `CREATE UNIQUE INDEX idx_session_completeness_data_session_key
   ...` unconditionally, but the acceptance gate requires re-deploy
   idempotence. A second run would fail with "relation already exists".
   Rev2 wraps every CREATE in `IF NOT EXISTS` and gates the relkind
   handling with `DO $$` blocks that branch on current state.
3. **Medium — Slice B stale framing in Case B + repo-grounding.** The
   "Why this matters" Case B paragraph and the repo-grounding bullet
   for `flushTrace site` still described rev0's misdiagnosis ("lands
   after response close", "sampling is not relevant"), contradicting
   the rev1 slice body. Rev2 rewrites both to match the actual root
   cause (sampling drops the spans line; `forceFlush` per-request
   override is the fix).
4. **Medium — `traceEnabled` scope.** The orchestration's
   `traceEnabled` const (`orchestration.ts:374`) is currently scoped
   inside the main `try` block, so a `forceFlush: traceEnabled` call
   in the outer `finally` won't compile. Rev2 spec hoists it to a
   `let traceEnabled = false` declared before the `try`, with the
   actual assignment kept in its current location after body parse.

No open questions remain at rev2.



## Revision 1 (2026-05-02 post-audit-1)

A first audit caught five issues:

1. **High — Slice C is not reproducible on a fresh Neon branch.** rev0
   used `DROP MATERIALIZED VIEW IF EXISTS core.session_completeness;
   CREATE MATERIALIZED VIEW ...`. On a fresh branch only the regular
   view from `005_helper_tables.sql:459` exists; `DROP MATERIALIZED
   VIEW IF EXISTS` does not drop a regular view, so the subsequent
   CREATE fails with `relation already exists`. Rev1 detects the
   pre-existing relkind and drops it with the correct DDL.
2. **High — Slice C misses dependent views.** `core.weekend_session_coverage`
   joins `core.session_completeness` (`005_helper_tables.sql:702`) and
   `core.weekend_session_expectation_audit` (`005_helper_tables.sql:772`)
   chains off it (verified on Neon: `pg_depend` shows
   `weekend_session_expectation_audit` is a dependent view of
   `session_completeness` via the chain). A plain `DROP` of the
   matview will fail with "cannot drop ... because other objects
   depend on it". Rev1 uses a **storage-table + facade-view pattern**
   so dependents never see a different relkind: `core.session_completeness`
   stays a view; underneath it reads from a new
   `core.session_completeness_data` materialized view with the heavy
   COUNT/GROUP BY.
3. **High — Slice B misdiagnoses the smoke result.** The smoke script
   sends JSON, not SSE (`scripts/phase17_chat_smoke.py:174`), and the
   JSON path already awaits `runChatRoute` whose `finally` awaits
   `flushTrace` (`orchestration.ts:274` → `runChatRoute` finally at
   `orchestration.ts:1574`). So this is **not** a response-close race.
   The actual cause is `flushTrace`'s built-in sampling
   (`perfTrace.ts:101`): it returns early unless
   `OPENF1_CHAT_DEBUG_TRACE=1` or `OPENF1_PERFTRACE_SAMPLE_RATE > 0`.
   The smoke script's `debug.trace=true` body flag is honored by
   `appendQueryTrace` (the per-event JSONL log) but **not** by
   `flushTrace` (the spans line). Rev1 fixes the contract: the
   request's `debug.trace` flag forces the spans flush regardless of
   sampling, so synchronous consumers (smoke, CI, future SDK) get
   spans whenever they ask for them.
4. **Medium — Slice A is under-scoped.** rev0 enumerated split-file
   templates only. `web/src/lib/deterministicSql.ts` still contains
   inline templates pre/post the Phase 9 split — sector-spread,
   consistency, top-speed, running-order, fresh-vs-used-tyres
   (`deterministicSql.ts:344, 416, 470`). Rev1 adds a unit test that
   walks every `templateKey:` literal in the deterministic-SQL files
   and requires either a `topicMetadata` annotation or an explicit
   exemption.
5. **Medium — flush dedupe must mark only after success.** rev0 said
   "add a `flushedRequests: Set<string>`". `flushTrace` swallows
   write errors internally (`perfTrace.ts:113-119`), so a Set marked
   pre-write would silently suppress a legitimate retry on transient
   FS failure. Rev1 spec: `flushTrace` returns `boolean` (true iff
   appended), and the dedupe Set is only marked on `true`. Pair this
   with the in-band call flushing first, finally call as the
   defensive retry.

No open questions remain at rev1.



Three follow-ups surfaced during the Phase 17 close-out smoke (18/18 ✓
on 2026-05-02 against the Neon production dataset). None block Phase 17
closure; all are real defects worth fixing as a single bundled phase so
codex can audit the whole thing.

## Why this matters (the case studies)

**Case A — template-router false-match.** The `phase17_chat_smoke.py`
script's first iteration phrased the high-complexity question as
*"Compare the tyre stint strategies of {driver_a} and {driver_b} in the
{venue} race."* The chat route returned `generationSource:
deterministic_template` with the answer *"Oscar PIASTRI leads on average
lap (89) versus Yuki TSUNODA (90), a gap of 1."* That is the
`max_leclerc_lap_pace_summary` template (web/src/lib/deterministicSql/pace.ts:591)
matching on `["lap pace","compare"] + hasComparisonLanguage` — but the
user asked about **tyre stints**, not lap pace. The deterministic path
is silently authoritative when a template matches, so the LLM-gen path
never sees the question, and the user gets a confidently wrong answer.

**Case B — `flushTrace` silently drops the spans line under default
sampling, even when the request asks for trace.** The smoke script
sends `body.debug.trace = true` (`scripts/phase17_chat_smoke.py:174`)
and the JSON path at `orchestration.ts:274` already awaits
`runChatRoute` whose `finally` awaits `flushTrace`
(`orchestration.ts:1574`) — so this is **not** a response-close race.
The actual cause is `flushTrace`'s sampling check at
`web/src/lib/perfTrace.ts:101-102`: it returns early unless
`OPENF1_CHAT_DEBUG_TRACE=1` or `OPENF1_PERFTRACE_SAMPLE_RATE > 0`.
Neither is set in the smoke script's environment. The route honors
`body.debug.trace=true` for the per-event `appendQueryTrace` writes
but **not** for the `flushTrace` spans line, so synchronous
consumers asking for trace get only the per-event status records and
no span breakdown. 18/18 smoke runs reported "(no spans)" for
exactly this reason.

**Case C — `core.session_completeness` matview goes stale.** The
matview was created by hand on 2026-05-02 from a regular view that
re-scanned every `raw.*` table per query (166s observed; converted to
matview during Phase 17 troubleshooting). It is **never refreshed** —
neither by sqitch (no migration), nor by `scripts/ingest.mjs` (no
REFRESH call), nor by any cron. Every new ingest leaves
`session_completeness` increasingly stale until someone runs
`REFRESH MATERIALIZED VIEW` by hand. Within a few weeks, every new
session will be invisible to the resolver's `is_future_session` /
`is_placeholder` filters.

## Repo grounding (verified 2026-05-02)

- **Pace template false-match**: `web/src/lib/deterministicSql/pace.ts:591`
  triggers on `driverPairSql && includesAny(lower, ["lap pace","compare"])
  && hasComparisonLanguage`. The match is a positive test (any of the
  trigger words present) with **no negative test** for non-pace topics
  ("tyre", "stint", "compound", etc.).
- **`hasComparisonLanguage` definition**: `web/src/lib/deterministicSql/pace.ts:43-50`
  — array of generic comparison words including `"compare","comparison","versus","vs.","gap"`
  with no semantic gating against unrelated subjects.
- **flushTrace site**: `web/src/app/api/chat/orchestration.ts:1586`
  inside the outer `finally` block. Important: in the JSON path
  (`orchestration.ts:274`) `runChatRoute` is awaited before
  `NextResponse.json` resolves, so by the time the response reaches
  the client the `finally` has already run. There is **no**
  response-close race. (rev0 misread this; rev1 corrected.)
- **flushTrace impl**: `web/src/lib/perfTrace.ts:101` writes via
  `appendFile` (line 116). The first thing it does is consult
  `shouldSampleTrace()` (`perfTrace.ts:93-99,102`) — when neither
  `OPENF1_CHAT_DEBUG_TRACE=1` nor a positive
  `OPENF1_PERFTRACE_SAMPLE_RATE` is set, the function returns early
  and no spans entry is written. This sampling drop is exactly the
  smoke-script symptom; Slice B fixes it with a per-request
  `forceFlush` override.
- **`traceEnabledForRequest` scope**: the existing
  `traceEnabledForRequest(body)` flag is computed at
  `orchestration.ts:374` inside the inner `try`. Slice B requires
  hoisting a `let traceEnabled = false` before the outer `try` so
  the outer `finally`'s `flushTrace(..., { forceFlush: traceEnabled })`
  call is in scope and TypeScript-clean.
- **session_completeness matview**: created on Neon during Phase 17
  troubleshooting (no migration file in `sql/migrations/deploy/`).
  `relkind='m'` on Neon, 176 kB, indexed by
  `idx_session_completeness_mat_session_key`. Renamed view
  `core.session_completeness_view_old` is still around as a rollback
  reference.
- **Ingest script**: `scripts/ingest.mjs` does not contain "REFRESH" or
  "materialized" anywhere. No matview-refresh hook exists today.
- **Smoke script consumer**: `scripts/phase17_chat_smoke.py:138`
  (`extract_spans`) walks `chat_query_trace.jsonl` for the requestId
  with a 0.4s sleep before reading. The 0.4s is empirically not enough
  in 18/18 runs.

## Slice breakdown — Phase 18 (3 slices, ~1 day total)

| # | Slice | Risk | Effort |
|---|---|---|---|
| A | `18-template-router-precision-guards` | Medium | 6 hr (rev0: 4 hr; rev1 widened scope to include legacy monolith templates and the coverage-enumeration test) |
| B | `18-flushtrace-honor-debug-trace-flag` | Low | 2 hr (rev0 was misnamed `flushtrace-await-before-response-close`; rev1 root-cause is sampling, not race) |
| C | `18-session-completeness-storage-and-refresh` | Medium | 5 hr (rev0: 2 hr; rev1: 4 hr added storage-table + facade-view; rev2: +1 hr for full 3-dependent set, idempotent CREATE IF NOT EXISTS, and avoid-CASCADE-on-fresh-branch split) |

A is the user-visible bug (wrong answers from the templated path). B
is operator-visibility plumbing. C is operational hygiene (prevents
silent staleness).

---

### Slice 18-template-router-precision-guards

**Problem.** Deterministic templates in
`web/src/lib/deterministicSql/{pace,strategy,result,telemetry,dataHealth}.ts`
match on the presence of trigger words but do **not** test for the
absence of unrelated topics. So
*"Compare the tyre stint strategies of A and B in race X"* matches the
**lap-pace comparator** template (which sees `compare` + a driver pair)
and returns a pace gap. The LLM-gen path is bypassed despite being the
correct route.

**Steps**:
1. New helper `web/src/lib/deterministicSql/topicGuards.ts` exposing
   `topicSignal(text)` that returns a small set like
   `{ pace: boolean, stint: boolean, strategy: boolean, telemetry: boolean,
     dataHealth: boolean }`. Each flag is a positive-keyword test:
   - `pace` ← `lap pace`, `lap time`, `pace summary`, `sector pace`,
     `clean lap pace`, `average lap`
   - `stint` ← `stint`, `stints`, `tyre`, `tire`, `compound`,
     `pit window`, `pit cycle`
   - `strategy` ← `strategy`, `pit stops`, `pit count`, `undercut`,
     `overcut`
   - `telemetry` ← `telemetry`, `top speed`, `throttle`, `brake`, `gear`
   - `dataHealth` ← `coverage`, `complete`, `ingest`, `rows in`
2. Each candidate template adds a **conflict guard**: the template only
   fires when its own topic signal is true AND no incompatible topic
   signal is true. For
   `web/src/lib/deterministicSql/pace.ts:591`, the guard becomes:
   ```ts
   const sig = topicSignal(message);
   if (sig.stint || sig.strategy) return null; // wrong topic
   if (driverPairSql && includesAny(lower, ["lap pace","compare"])
       && hasComparisonLanguage && sig.pace) {
     return { templateKey: "max_leclerc_lap_pace_summary", sql: ... };
   }
   ```
   Apply the same gating discipline to every template across the
   deterministic-SQL surface. **Authoritative audit list (rev1)**: the
   slice author runs `grep -rn 'templateKey:' web/src/lib/deterministicSql.ts web/src/lib/deterministicSql/*.ts`
   and enumerates ALL hits. The rev0 list was incomplete — it named
   only the post-Phase-9 split files, missing inline templates in the
   legacy monolith `web/src/lib/deterministicSql.ts` (sector-spread
   line ~344, consistency line ~416, top-speed line ~470, plus
   running-order and fresh-vs-used-tyres branches). Every
   `templateKey:` literal across all six files
   (`deterministicSql.ts` + `deterministicSql/{pace,strategy,result,
   telemetry,dataHealth}.ts`) gets a topic guard.
3. **Topic taxonomy mapping** (the audit deliverable):
   - `pace`: every template whose answer is a lap time, sector time,
     pace gap, or pace summary.
   - `stint`: every template whose answer mentions tyre compounds,
     stint counts, stint lengths, or pit windows.
   - `strategy`: pit-stop counts/timing, undercut/overcut analysis.
   - `telemetry`: top-speed, throttle, brake, gear data.
   - `dataHealth`: coverage / completeness / ingest questions.
   Hybrids (e.g. `stint_pace_vs_tire_age`, `pre_post_pit_pace`) sit
   in two flags and are explicitly documented in the audit table.
4. **Failing-fixture regression test** at
   `web/scripts/tests/template-router-topic-guards.test.mjs`:
   - Input: *"Compare the tyre stint strategies of Yuki Tsunoda and
     Oscar Piastri in the Bahrain Grand Prix 2025 race."* →
     `buildDeterministicSqlTemplate` returns `null` (LLM-gen takes over).
   - Input: *"Compare the lap pace of Yuki Tsunoda and Oscar Piastri in
     the Bahrain Grand Prix 2025 race."* →
     `buildDeterministicSqlTemplate` returns
     `templateKey: "max_leclerc_lap_pace_summary"`.
   - Each existing curated benchmark question that today returns a
     specific deterministic template still does (no false-negative
     regressions).
5. **Coverage-enumeration test** at
   `web/scripts/tests/template-router-topic-coverage.test.mjs`:
   - Greps every `templateKey: "..."` literal across
     `web/src/lib/deterministicSql.ts` and
     `web/src/lib/deterministicSql/*.ts`.
   - Asserts each templateKey is annotated in a central
     `TEMPLATE_TOPICS: Record<string, TopicSet>` map (or explicitly
     listed in `TEMPLATE_TOPICS_EXEMPT` with a one-line justification).
   - Test fails when a NEW templateKey is added without a topic
     annotation, so future template authors can't accidentally add
     an unguarded template.
4. **Curated benchmark gate**: re-run `npm run healthcheck:chat` — every
   question that previously hit a deterministic template should still
   hit it; new behavior is templates that previously matched a
   stint/strategy question now correctly return null.
5. **Smoke script**: `scripts/phase17_chat_smoke.py` is updated to
   include the original false-match phrasing as a regression case for
   the high tier (alongside the existing per-driver stint phrasing).

**Acceptance**:
- The exact 2026-05-02 false-match phrasing returns
  `generationSource: "anthropic"` (or `"anthropic_repaired"`), NOT
  `"deterministic_template"`.
- Curated 50-question benchmark: zero regressions in templateKey
  hit-rate.
- New unit test passes; `npm run typecheck` clean.

**Out of scope**:
- Rewriting templates to compute their own conflict topics from SQL
  shape (heuristic; defer).
- Replacing the regex+keyword matcher with an LLM intent classifier
  (Phase 17-H tools-use territory).
- Surfacing "did you mean a tyre stint question?" disambiguation to
  the user when a near-miss is detected.

### Slice 18-flushtrace-honor-debug-trace-flag

**Problem (corrected at rev1).** The smoke script's 18/18 "no spans"
result is **not** a response-close race — the JSON branch at
`orchestration.ts:274` already awaits `runChatRoute`, whose outer
`finally` at `orchestration.ts:1574` awaits `flushTrace` before
resolving. The actual cause is in `flushTrace` itself: it consults
`shouldSampleTrace()` first (`perfTrace.ts:93-99,102`) which returns
`false` unless `OPENF1_CHAT_DEBUG_TRACE=1` or
`OPENF1_PERFTRACE_SAMPLE_RATE > 0` — neither is set in the smoke
script's environment. The route honors `body.debug.trace=true` for
the per-event `appendQueryTrace` writes (the `chat_query_trace.jsonl`
status lines), but `flushTrace` has no per-request override, so the
spans entry is silently dropped. Synchronous consumers asking for
trace via `debug.trace` get partial data.

**Steps**:
1. Extend `flushTrace` signature with an optional
   `forceFlush: boolean` argument. When `forceFlush === true` the
   sampling check is bypassed:
   ```ts
   export async function flushTrace(
     requestId: string,
     spans: SpanRecord[],
     options: { forceFlush?: boolean } = {}
   ): Promise<boolean> {
     if (!options.forceFlush && !shouldSampleTrace()) return false;
     // ... existing append logic, returns true on successful write
   }
   ```
2. **Return type change**: `flushTrace` now returns `Promise<boolean>`
   (true on appended, false on sampled-out, false on caught write
   error). This is required for the safe dedupe in step 4 — Set is
   marked **only when the flush returned true**.
3. Plumb the per-request flag through orchestration:
   ```ts
   // orchestration.ts at the existing flushTrace call site (~1586)
   await flushTrace(requestId, traceRecords, { forceFlush: traceEnabled });
   ```
   `traceEnabled` is already computed at `orchestration.ts:374`
   (`traceEnabledForRequest(body)`) — same flag that already gates
   `appendQueryTrace`. **Hoisting requirement**: today the const is
   declared inside the inner `try` block, so the outer `finally`
   that runs `flushTrace` doesn't see it. Implementer hoists a
   `let traceEnabled = false` BEFORE the outer `try` and keeps the
   actual assignment (`traceEnabled = traceEnabledForRequest(body)`)
   in its current location after body parse. Default-false is the
   right preserved-behavior fallback when the body parse throws
   before the assignment runs (in that case nobody asked for
   trace, so `forceFlush: false` keeps production sampling
   semantics). This makes the contract uniform: a request with
   `debug.trace=true` always gets BOTH the per-event status lines
   and the spans entry.
4. **Re-entrant flush guard**: add a process-scope LRU
   `Set<string>` (capped at 4096 entries to avoid leaks) of
   request IDs that have already had a successful `flushTrace`
   landed. The set is marked **after** `appendFile` resolves, never
   before. A second `flushTrace(requestId, ...)` call short-circuits
   to `return false` (already-flushed). This makes the defensive
   `finally` call idempotent without suppressing real retries on
   transient FS errors (those leave the Set unmarked, so the next
   call retries).
5. **Optional follow-on**: move the in-band `flushTrace` call ahead
   of the outer `finally` in `runChatRoute` so the spans line lands
   slightly earlier in the request lifecycle. This is purely an
   optimization; the rev1 root-cause fix above (steps 1-4) is what
   actually closes the smoke-script gap.
6. **Test** at `web/scripts/tests/flushtrace-debug-trace-flag.test.mjs`:
   - Stub `appendFile`. With `OPENF1_PERFTRACE_SAMPLE_RATE` unset and
     `OPENF1_CHAT_DEBUG_TRACE` unset and `forceFlush: false`,
     `flushTrace` returns `false` and `appendFile` is not called.
   - With `forceFlush: true`, `appendFile` IS called, returns `true`.
   - With `forceFlush: false` and `OPENF1_PERFTRACE_SAMPLE_RATE=1`,
     `appendFile` IS called, returns `true`.
   - Idempotence: two calls with the same `requestId` in a process
     produce one `appendFile` call total.
   - Recovery: when `appendFile` rejects, `flushTrace` returns `false`
     and the dedupe Set stays empty so a retry is allowed.
7. **Smoke-script proof**: re-run `phase17_chat_smoke.py` — every
   trial reports a non-empty span list. (The script already sends
   `debug.trace: true` so no script change is required.)

**Acceptance**:
- All 6 trials in `phase17_chat_smoke.py` print real span tuples (no
  more "(no spans)" lines).
- The new unit test passes; `npm run typecheck` clean.
- No regression in production sampling: when neither
  `OPENF1_CHAT_DEBUG_TRACE` nor a positive sample rate is set, and
  the request body has no `debug.trace`, `flushTrace` still returns
  early as it does today.

**Out of scope**:
- Switching from append-mode JSONL to a structured sink (Postgres,
  OTLP, etc.). That's a Phase 16-1 follow-up.
- Pushing per-stage spans to the SSE stream as `event: trace` frames.
- Adjusting the production sampling fraction logic itself; this
  slice only adds a per-request override path.

### Slice 18-session-completeness-storage-and-refresh

**Problem (rev2, dependency-complete scope).**
`core.session_completeness` is defined as a regular view in
`sql/migrations/deploy/005_helper_tables.sql:459`. On the audited
Neon DB it's a materialized view (hand-created during Phase 17
troubleshooting); on a fresh Neon branch it's still a view per the
repo. Three complications a naive matview swap misses:
- **relkind mismatch**: `DROP MATERIALIZED VIEW IF EXISTS` doesn't
  drop a regular view of the same name. CREATE then errors.
- **dependent views (full set, verified via `pg_depend` on
  2026-05-02)**:
  1. `core.weekend_session_coverage` (`005_helper_tables.sql:702`) —
     joins `session_completeness` directly.
  2. `core.weekend_session_expectation_audit`
     (`005_helper_tables.sql:772`) — chains off
     `weekend_session_coverage`.
  3. `core.source_anomaly_tracking` (`005_helper_tables.sql:845`) —
     references both `session_completeness` directly (`:890`) and
     `weekend_session_expectation_audit` (`:1068`).
  A `DROP CASCADE` would silently remove all three. Rev1 missed
  `source_anomaly_tracking`.
- **idempotence**: re-deploying the migration must not fail on
  already-existing relations or indexes; `CREATE MATERIALIZED VIEW`
  errors on existing relations unless guarded with `IF NOT EXISTS`.

**Decision (rev2)**: keep the **storage-table + facade-view pattern**
so dependents never see a relkind change. Two paths:

- **Fresh-branch path** (relkind='v' on entry): `CREATE OR REPLACE
  VIEW core.session_completeness AS SELECT * FROM
  core.session_completeness_data` rewrites the view body in place.
  No CASCADE, dependents unaffected.
- **Phase-17-artifact path** (relkind='m' on entry): drop the
  Phase-17 matview with explicit `CASCADE`, then recreate the
  facade view AND all three dependent views (verbatim from 005)
  in topological order. Listed explicitly to avoid silent
  removal.

**Steps**:
1. **New migration** at
   `sql/migrations/deploy/028_session_completeness_data_matview.sql`
   (+ matching `revert/` and `verify/` triplet):

   ```sql
   -- Deploy openf1:028_session_completeness_data_matview to pg
   -- requires: 027_user_feedback
   --
   -- Idempotent on three states:
   --   (A) fresh branch: core.session_completeness is a view from 005
   --   (B) audited Neon: core.session_completeness is a matview from
   --       Phase 17 troubleshooting + a stale view named
   --       core.session_completeness_view_old
   --   (C) re-deploy: 028 already applied; should be a no-op

   BEGIN;

   -- Drop legacy Phase-17 rollback artifact if present.
   DROP VIEW IF EXISTS core.session_completeness_view_old;

   -- 1) Storage matview. Idempotent: only created on first run; body
   --    is captured from pg_get_viewdef of the original 005 view so
   --    the row shape matches what dependents already select.
   CREATE MATERIALIZED VIEW IF NOT EXISTS core.session_completeness_data AS
   <... body of original core.session_completeness from
        005_helper_tables.sql:459-700 ...>;

   -- 1a) Column-shape verify. CREATE ... IF NOT EXISTS skips creation
   --     when the relation exists, but a partial prior deploy could
   --     have left a matview with the wrong column set/order/types.
   --     Compare the actual shape (read from pg_attribute, since
   --     information_schema.columns does NOT enumerate matview
   --     columns — verified 2026-05-02) against the canonical 45-
   --     column projection from 005_helper_tables.sql and RAISE on
   --     any divergence.
   --
   -- The expected list below is the authoritative projection of
   -- `core.session_completeness` as captured from Neon's pg_attribute
   -- on 2026-05-02. To regenerate (do this whenever the upstream
   -- view body in 005 changes):
   --
   --   SELECT a.attnum, a.attname,
   --          format_type(a.atttypid, a.atttypmod) AS atttype
   --   FROM pg_attribute a
   --   JOIN pg_class c ON c.oid = a.attrelid
   --   JOIN pg_namespace n ON n.oid = c.relnamespace
   --   WHERE n.nspname='core' AND c.relname='session_completeness'
   --     AND a.attnum > 0 AND NOT a.attisdropped
   --   ORDER BY a.attnum;
   --
   -- pg_get_viewdef('core.session_completeness') captures the source
   -- SQL body for the matview body itself (used in step 1 above);
   -- pg_attribute is the right source for the projection metadata.

   DO $$
   DECLARE
     bad_count int;
     bad_summary text;
   BEGIN
     WITH expected(attnum, attname, atttype) AS (
       VALUES
         ( 1, 'session_key',             'bigint'),
         ( 2, 'meeting_key',             'bigint'),
         ( 3, 'year',                    'integer'),
         ( 4, 'session_name',            'text'),
         ( 5, 'session_type',            'text'),
         ( 6, 'country_name',            'text'),
         ( 7, 'location',                'text'),
         ( 8, 'circuit_short_name',      'text'),
         ( 9, 'date_start',              'timestamp with time zone'),
         (10, 'drivers_rows',            'bigint'),
         (11, 'laps_rows',               'bigint'),
         (12, 'pit_rows',                'bigint'),
         (13, 'stints_rows',             'bigint'),
         (14, 'weather_rows',            'bigint'),
         (15, 'team_radio_rows',         'bigint'),
         (16, 'position_history_rows',   'bigint'),
         (17, 'intervals_rows',          'bigint'),
         (18, 'car_data_rows',           'bigint'),
         (19, 'location_rows',           'bigint'),
         (20, 'session_result_rows',     'bigint'),
         (21, 'starting_grid_rows',      'bigint'),
         (22, 'race_control_rows',       'bigint'),
         (23, 'overtakes_rows',          'bigint'),
         (24, 'has_laps',                'boolean'),
         (25, 'has_pit',                 'boolean'),
         (26, 'has_stints',              'boolean'),
         (27, 'has_weather',             'boolean'),
         (28, 'has_team_radio',          'boolean'),
         (29, 'has_position_history',    'boolean'),
         (30, 'has_intervals',           'boolean'),
         (31, 'has_car_data',            'boolean'),
         (32, 'has_location',            'boolean'),
         (33, 'has_session_result',      'boolean'),
         (34, 'has_starting_grid',       'boolean'),
         (35, 'has_race_control',        'boolean'),
         (36, 'has_overtakes',           'boolean'),
         (37, 'completeness_score',      'integer'),
         (38, 'has_core_analysis_pack',  'boolean'),
         (39, 'has_drivers',             'boolean'),
         (40, 'meeting_name',            'text'),
         (41, 'normalized_session_type', 'text'),
         (42, 'is_future_session',       'boolean'),
         (43, 'is_placeholder',          'boolean'),
         (44, 'has_meeting_name',        'boolean'),
         (45, 'completeness_status',     'text')
     ),
     actual AS (
       SELECT a.attnum::int       AS attnum,
              a.attname::text     AS attname,
              format_type(a.atttypid, a.atttypmod)::text AS atttype
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='core'
         AND c.relname='session_completeness_data'
         AND a.attnum > 0
         AND NOT a.attisdropped
     ),
     diff AS (
       SELECT
         COALESCE(e.attnum, a.attnum)         AS attnum,
         e.attname AS expected_name, a.attname AS actual_name,
         e.atttype AS expected_type, a.atttype AS actual_type,
         CASE
           WHEN e.attnum IS NULL THEN 'unexpected'
           WHEN a.attnum IS NULL THEN 'missing'
           WHEN e.attname <> a.attname THEN 'name_mismatch'
           WHEN e.atttype <> a.atttype THEN 'type_mismatch'
         END AS reason
       FROM expected e
       FULL OUTER JOIN actual a USING (attnum)
       WHERE e.attnum IS NULL
          OR a.attnum IS NULL
          OR e.attname <> a.attname
          OR e.atttype <> a.atttype
     )
     SELECT COUNT(*),
            string_agg(
              format('attnum=%s reason=%s expected=(%s,%s) actual=(%s,%s)',
                     attnum, reason,
                     COALESCE(expected_name,'<none>'),
                     COALESCE(expected_type,'<none>'),
                     COALESCE(actual_name,'<none>'),
                     COALESCE(actual_type,'<none>')),
              E'\n' ORDER BY attnum
            )
       INTO bad_count, bad_summary
     FROM diff;

     IF bad_count > 0 THEN
       RAISE EXCEPTION
         '028: core.session_completeness_data column shape diverges from canonical 005 projection (% mismatches): %',
         bad_count, bad_summary;
     END IF;
   END $$;

   -- Unique index: required for REFRESH ... CONCURRENTLY.
   CREATE UNIQUE INDEX IF NOT EXISTS idx_session_completeness_data_session_key
     ON core.session_completeness_data (session_key);

   -- 2) Convert core.session_completeness to a facade view that
   --    selects from the storage matview, regardless of current
   --    relkind.
   DO $$
   DECLARE
     rk char;
   BEGIN
     SELECT c.relkind INTO rk
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'session_completeness';

     IF rk IS NULL THEN
       -- Should be impossible given 005 is a precondition, but cover
       -- it defensively.
       EXECUTE 'CREATE VIEW core.session_completeness AS '
            || 'SELECT * FROM core.session_completeness_data';

     ELSIF rk = 'v' THEN
       -- Fresh-branch path: the 005 view exists with its original
       -- COUNT/GROUP BY body. CREATE OR REPLACE rewrites the body in
       -- place WITHOUT touching dependents. No CASCADE needed.
       EXECUTE 'CREATE OR REPLACE VIEW core.session_completeness AS '
            || 'SELECT * FROM core.session_completeness_data';

     ELSIF rk = 'm' THEN
       -- Audited-Neon path: the Phase-17 hand-rolled matview is in
       -- place. We must drop it; CREATE OR REPLACE VIEW cannot turn
       -- a matview into a view. CASCADE drops dependents, which we
       -- then explicitly recreate (NOT CASCADE-by-omission).
       --
       -- Verified dependents on 2026-05-02 via pg_depend:
       --   - core.weekend_session_coverage          (005:702)
       --   - core.weekend_session_expectation_audit (005:772)
       --   - core.source_anomaly_tracking           (005:845)
       DROP MATERIALIZED VIEW core.session_completeness CASCADE;

       EXECUTE 'CREATE VIEW core.session_completeness AS '
            || 'SELECT * FROM core.session_completeness_data';
     ELSE
       RAISE EXCEPTION
         '028: unexpected relkind % on core.session_completeness', rk;
     END IF;
   END $$;

   -- 3) Idempotently re-create every dependent view from its 005
   --    body. CREATE OR REPLACE handles both first-deploy after
   --    CASCADE drop AND re-deploys where the views still exist
   --    unchanged. Bodies copied verbatim from 005_helper_tables.sql.

   CREATE OR REPLACE VIEW core.weekend_session_coverage AS
   <... body from 005_helper_tables.sql:702-770 ...>;

   CREATE OR REPLACE VIEW core.weekend_session_expectation_audit AS
   <... body from 005_helper_tables.sql:772-843 ...>;

   CREATE OR REPLACE VIEW core.source_anomaly_tracking AS
   <... body from 005_helper_tables.sql:845-1080 ...>;

   COMMIT;
   ```

   Verify migration asserts (sqitch verify file —
   `sql/migrations/verify/028_*.sql` — runs on every deploy
   target including empty test branches, so all checks here are
   schema-only / `LIMIT 0`):
   - `core.session_completeness` has `relkind='v'` (facade)
   - `core.session_completeness_data` has `relkind='m'` (storage)
   - `idx_session_completeness_data_session_key` is unique on
     `session_key`
   - column-shape parity verify on
     `core.session_completeness_data` against the canonical 005
     projection (the same `DO $$` block as step 1a, idempotent).
   - `SELECT * FROM core.session_completeness LIMIT 0`,
     `SELECT * FROM core.weekend_session_coverage LIMIT 0`,
     `SELECT * FROM core.weekend_session_expectation_audit LIMIT 0`,
     `SELECT * FROM core.source_anomaly_tracking LIMIT 0` all
     succeed (proves bodies compile after the swap).
   - re-running the migration's `BEGIN ... COMMIT` block produces
     no errors and no diff in `pg_class.relkind` for the five
     affected relations (storage + facade + 3 dependents).

   Data-dependent checks (matview/dependent row counts, ingest
   refresh-hook end-to-end) live in `phase17_neon_setup.py` not
   in the sqitch verify file, so they don't fire on an empty
   test branch.

2. **Refresh hook in `scripts/ingest.mjs`**: at the end of every
   successful ingest run, fire
   `REFRESH MATERIALIZED VIEW CONCURRENTLY core.session_completeness_data;`
   (CONCURRENTLY requires the unique index that step 1 ensures).
   - On `REFRESH` failure (e.g. CONCURRENTLY's "first refresh must
     be non-concurrent" rule on a brand-new matview), fall back to
     a non-concurrent `REFRESH` once, then continue.
   - Log elapsed ms; do NOT fail the ingest run on refresh error
     (the matview is a perf optimization, not a correctness gate).

3. **Standalone refresh script** at
   `scripts/refresh_completeness_matview.py` for ops to run out of
   band. Reads `NEON_DB_*` from `.env`, fires
   `REFRESH MATERIALIZED VIEW CONCURRENTLY core.session_completeness_data`,
   prints elapsed ms and a row count delta. Documented in
   `diagnostic/phase_13_neon_backfill_runbook.md`.
   **Implementation note (rev3)**: psycopg2 opens an implicit
   transaction block by default, and `REFRESH MATERIALIZED VIEW
   CONCURRENTLY` cannot run inside a transaction (Postgres rejects it
   with `cannot run inside a transaction block`). The script MUST
   set `conn.autocommit = True` before issuing the refresh, or fall
   back to non-CONCURRENT refresh. CONCURRENT is preferred (keeps
   readers unblocked during refresh), so default to autocommit:
   ```python
   conn = psycopg2.connect(**kwargs)
   conn.autocommit = True   # required for REFRESH ... CONCURRENTLY
   with conn.cursor() as cur:
       cur.execute(
           "REFRESH MATERIALIZED VIEW CONCURRENTLY core.session_completeness_data"
       )
   ```
   `scripts/ingest.mjs` doesn't have this issue because it shells out
   to `psql -c`, which runs each command in autocommit by default.

4. **Smoke**: `scripts/phase17_neon_setup.py` adds acceptance
   checks split into two layers so the schema layer runs
   identically on empty/dev branches and populated production:

   **Schema-only (always runs)**:
   - `core.session_completeness` exists with `relkind='v'` (facade)
   - `core.session_completeness_data` exists with `relkind='m'` (storage)
   - `idx_session_completeness_data_session_key` is unique on
     `session_key`
   - all three dependents compile and select clean — verified via
     `SELECT * FROM <view> LIMIT 0` (returns zero rows by
     construction; the assertion is that the SELECT *itself*
     succeeds, proving the view's body still references valid
     columns):
     `core.weekend_session_coverage`,
     `core.weekend_session_expectation_audit`,
     `core.source_anomaly_tracking`.
   - column-shape parity for `core.session_completeness_data`
     matches the canonical 005 projection (same names, same types,
     same ordinal positions). Catches a partial-deploy state where
     `IF NOT EXISTS` would otherwise silently keep a wrong-shaped
     matview.
   - `pg_depend` enumeration of `session_completeness` returns the
     same dependent set as before the migration (dependency-graph
     parity check — catches any future migration that accidentally
     drops a dependent without recreating it).

   **Data-dependent (gated on `OPENF1_ASSUME_POPULATED=1`, default
   on for hosts containing `neon.tech`, opt-out via `=0`)**:
   - `SELECT COUNT(*) FROM core.session_completeness_data > 0`
   - at least one of the three dependents returns ≥ 1 row.
   - real test: ingest one new session, confirm
     `is_future_session = false` shows up in
     `core.session_completeness` within the same ingest run
     (proves the refresh hook fires on the fresh data).

5. **Sqitch tracking**: deploy 028 via the standard
   `sqitch deploy --target` path so `sqitch.changes` records the
   migration. The Python helper continues to work as a
   sqitch-bypass fallback (it ran 024-026 by hand on the audited
   Neon DB, which lacked the sqitch.changes table).

6. **Neon-current state cleanup**: on the existing Neon dataset that
   already has the hand-created matview, the migration's
   `DROP MATERIALIZED VIEW core.session_completeness CASCADE` cleanly
   removes the Phase 17 hand-rolled artifact and the migration
   replays its dependents from the canonical bodies. Verify-script
   covers re-deploy idempotence.

**Acceptance**:
- `sql/migrations/deploy/028_*.sql` lands and is idempotent: re-deploy
  produces the same final relkinds and same dependents (no
  pg_class diff between deploy N and deploy N+1).
- On a fresh Neon branch (no Phase 17 hand artifacts), 028 takes the
  `relkind='v'` branch: the 005 view body is rewritten in place via
  `CREATE OR REPLACE VIEW` with NO CASCADE; all three dependents
  remain pristine and continue to compile.
- On the audited Neon DB (with the Phase 17 matview already in
  place), 028 takes the `relkind='m'` branch: matview dropped with
  CASCADE, all three dependents are explicitly recreated from their
  005 bodies, parity check passes.
- A second consecutive deploy on either DB takes either the `v`
  branch (now-true on both) and produces zero schema changes —
  proves the migration is fully idempotent.
- `scripts/ingest.mjs` runs the REFRESH at end of run and surfaces
  elapsed ms in stdout.
- `scripts/refresh_completeness_matview.py` runs end-to-end and
  reports `after_count >= before_count`.
- `phase17_neon_setup.py` acceptance gate fails loudly if relkinds
  don't match (catches accidental future regressions).
- Real test: ingest one new session, confirm
  `is_future_session = false` shows up in `session_completeness`
  within the same ingest run (proves the refresh hook fires on the
  fresh data).

**Out of scope**:
- Wiring matview refresh to a managed scheduler (cron service,
  GitHub Actions, Neon Branches scheduled jobs). That's an ops
  decision.
- Converting other resolver-adjacent views to matviews. Only
  `session_completeness` was the demonstrated bottleneck on
  2026-05-02.
- Incremental / trigger-based recompute. Full
  `REFRESH CONCURRENTLY` is fine for current write rates and
  matview size (176 kB on 2026-05-02).

---

## Cross-cutting concerns

### Telemetry that needs to land alongside

- New perfTrace event types: `template_router_topic_rejected` (slice A
  emits when a candidate template returns null due to a topic guard,
  with the rejected templateKey + signals so we can monitor false-
  positive rate before/after).
- `flushTrace_late` warning if the defensive finally flush ever fires
  (slice B — should be ~0% in steady state).

### Migration ordering

Phase 18 depends on:
- Phase 17 deployed (matview + EXISTS probes already shipped).
- `sqitch.changes` table optional but recommended on Neon (see Phase 17
  audit-trail). 18-C creates a deploy entry; if `sqitch.changes` is
  missing the Python helper still applies the migration cleanly.

### Out of scope (separate efforts)

- LLM-driven intent classification to replace deterministic templates
  entirely (Phase 17-H tools-use territory).
- Replacing append-mode JSONL trace sink with structured sink (Phase
  16-1 follow-up).
- Backfilling additional matviews for resolver-adjacent views beyond
  `session_completeness`.
- Continuous matview refresh (e.g. logical replication, trigger-based
  incremental recompute). The simple full `REFRESH CONCURRENTLY`
  hook is enough for current write rates.

---

## Acceptance — what success looks like end-to-end

After Phase 18 lands:

| Metric | Before | Target |
|---|---|---|
| `phase17_chat_smoke.py` "(no spans)" rate | 18/18 (100%) | 0/18 |
| Tyre-stint comparison phrasing routed via deterministic template | yes (false-match) | no — LLM-gen |
| `core.session_completeness` staleness window | unbounded (manual) | ≤ 1 ingest run |
| sqitch tracking has 028 row | absent | present |
| Random 2-driver stint smoke produces correct stint listing | mostly via LLM-gen | always via LLM-gen |

The three follow-ups close the user-visible "wrong answer" path
(slice A), the operator-visibility gap (slice B), and the silent-
staleness risk (slice C).

## What this does NOT solve

- **Resolver hangs on cold Neon endpoints when the matview cache is
  evicted**: addressed by Phase 17-B's keepalive but a long enough
  idle period still pays a cold-cache penalty on the first request.
  Real fix is page-cache pre-warming or moving session_completeness
  to an indexed table; deferred.
- **Curated benchmark coverage of `core.stint_summary` LLM-gen path**:
  Phase 17-G already added `chat-health-check.questions.llm_contracts_2026-05-02.json`;
  Phase 18 doesn't expand it.
- **Deterministic template rate measurement in production**: needs
  Phase 16-1 sampler + new event types from this plan.

## Audit-trail / decisions log

- **Slice A scope**: chose conflict guards via positive topic-flags
  rather than a black-list of keywords per template — avoids the
  combinatorial explosion of "this template should reject these 30
  words" definitions and centralizes the topic vocabulary in one
  helper.
- **Slice A coverage** (rev1): rev0 named only post-Phase-9 split
  files; rev1 also covers legacy inline templates in
  `web/src/lib/deterministicSql.ts`. The new
  `template-router-topic-coverage.test.mjs` fails on any
  unannotated `templateKey:`, so future author can't bypass the
  guard discipline.
- **Slice B root cause** (rev1): rev0 misdiagnosed as a JSON
  response-close race. Verified via code trace: the JSON branch at
  `orchestration.ts:274` already awaits `runChatRoute`, whose
  `finally` awaits `flushTrace` (`orchestration.ts:1574`). The
  actual gap is `flushTrace`'s sampling check
  (`perfTrace.ts:101-102`) which silently drops the spans line
  unless `OPENF1_CHAT_DEBUG_TRACE=1` or `OPENF1_PERFTRACE_SAMPLE_RATE
  > 0`. rev1 adds a per-request `forceFlush` argument honored by
  the route's existing `traceEnabledForRequest(body)` flag.
- **Slice B re-entrant flush** (rev1): the dedupe Set is marked
  **only after a successful append**. `flushTrace` swallows write
  errors internally (`perfTrace.ts:113-119`); marking pre-write
  would silently suppress retries on transient FS failure. rev1
  changes `flushTrace` to return `Promise<boolean>` so the caller
  can dedupe correctly.
- **Slice C storage pattern** (rev1): rev0 swapped relkinds in place
  with `DROP MATERIALIZED VIEW IF EXISTS`. That fails on a fresh
  Neon branch where `core.session_completeness` is still a regular
  view (per `005_helper_tables.sql:459`), and additionally fails to
  account for dependents (`weekend_session_coverage`,
  `weekend_session_expectation_audit`). rev1 keeps
  `session_completeness` as a regular view facade and puts the
  matview underneath (`session_completeness_data`), so dependents
  never see a different relkind. The migration also explicitly
  re-runs the dependent-view bodies after the CASCADE drop.
- **Slice C migration vs hand-create**: chose a real sqitch
  migration even though the matview already exists on Neon, because
  re-deploys to fresh Neon branches (preview environments, dev
  snapshots) need to be reproducible without running the Python
  helper by hand.
- **Slice C dependent enumeration** (rev2): rev1 listed two
  dependents; `pg_depend` on Neon (2026-05-02) confirmed three —
  rev1 missed `core.source_anomaly_tracking` which references
  `session_completeness` directly at `005:890` and via
  `weekend_session_expectation_audit` at `005:1068`. rev2 names
  all three explicitly in the migration body and in the
  acceptance smoke check, plus adds a `pg_depend` parity check so
  any future migration that drops a dependent without recreating
  it fails loudly.
- **Slice C avoid-CASCADE-on-fresh path** (rev2): rev1 unconditionally
  used `DROP ... CASCADE` regardless of relkind, which would silently
  drop+recreate dependents even on a fresh branch where no such
  surgery is needed. rev2 splits into two paths — `relkind='v'` uses
  `CREATE OR REPLACE VIEW` with no CASCADE (dependents pristine);
  `relkind='m'` uses CASCADE plus explicit recreation. Cleaner, less
  collateral, and fail-loud if the relkind set ever changes.
- **Slice C idempotence** (rev2): rev1's `CREATE MATERIALIZED VIEW`
  + `CREATE UNIQUE INDEX` were unconditional and would error on
  re-deploy. rev2 wraps both in `IF NOT EXISTS`, and the relkind
  conversion is wrapped in a `DO $$` block whose branches are all
  no-ops on a re-run. Re-deploy parity is now an explicit acceptance
  gate.
- **Slice B repo-grounding rewrite** (rev2): rev1 left the rev0
  misdiagnosis stale in the Case-B paragraph and the
  flushTrace-site / flushTrace-impl bullets. rev2 rewrites both to
  match the corrected `forceFlush` root cause so an implementer
  reading the plan top-to-bottom doesn't see contradictory
  framing.
- **Slice B `traceEnabled` hoist** (rev2): the existing const is
  scoped inside the inner try block, so the outer finally's
  `flushTrace(..., { forceFlush: traceEnabled })` call wouldn't
  compile. rev2 explicitly specifies hoisting `let traceEnabled =
  false` before the outer try, with the assignment kept in its
  current location after body parse. Default-false preserves
  production sampling semantics for any path that throws before
  body-parse completes.
- **Slice C python-script autocommit** (rev3):
  `REFRESH MATERIALIZED VIEW CONCURRENTLY` is rejected inside
  Postgres transaction blocks, and psycopg2 opens one by default.
  rev3 spec requires `conn.autocommit = True` in
  `scripts/refresh_completeness_matview.py`. The
  `scripts/ingest.mjs` Node path is unaffected because it uses
  `psql -c` which already runs in autocommit.
- **Slice C wrong-shape mask** (rev3): rev2's
  `CREATE MATERIALIZED VIEW IF NOT EXISTS` could silently retain a
  wrong-shaped matview from a partial prior deploy. rev3 adds a
  column-shape verify (`information_schema.columns` join against the
  canonical 005 projection); on divergence the migration
  `RAISE EXCEPTION`s loudly so an operator investigates rather than
  letting downstream queries fail at use time.
- **Slice C smoke split** (rev3): rev2 required all three dependents
  to "return at least one row", which is data-dependent and brittle
  on empty test branches. rev3 splits acceptance into two layers:
  schema-only checks (`LIMIT 0` SELECTs, relkind / index / column
  shape / pg_depend parity) that run anywhere, and data-dependent
  checks gated on `OPENF1_ASSUME_POPULATED=1` (default-on for
  `neon.tech` hosts). Sqitch verify file uses only the schema-only
  layer.
- **Slice C verify executable SQL** (rev4): rev3 used a non-existent
  `NORMALIZE()` builtin. Rev4 replaces with a CTE-based
  `expected VALUES (...) FULL OUTER JOIN pg_attribute` pattern that
  surfaces missing/unexpected/type-mismatched columns by attnum.
  Pure standard SQL — no extension functions, no string-massage
  tricks.
- **Slice C authoritative column list** (rev4): rev3 inlined an
  illustrative 24-column sketch. The canonical projection captured
  from Neon `pg_attribute` is 45 columns, including
  `race_control_rows`, `overtakes_rows`, the full `has_*` boolean
  set, `completeness_score`, `meeting_name`,
  `normalized_session_type`, `completeness_status`. Rev4 inlines the
  full list in the migration body so the SQL is land-ready, with a
  documented regen recipe for when 005 changes.
- **Slice C correct introspection target** (rev4): rev3 said
  "regenerate via `pg_get_indexdef`", which is the wrong function
  (returns index definitions, not projection columns). It also
  implicitly assumed `information_schema.columns` would enumerate
  matview columns — which it doesn't (verified empty-result on
  Neon 2026-05-02). Rev4 corrects the regen recipe to `pg_attribute
  JOIN pg_class JOIN pg_namespace` for the projection metadata, and
  reserves `pg_get_viewdef` for capturing the source SQL body.
