# Phase 17 — LLM SQL-Gen Robustness Plan — 2026-05-02 (rev3. 2026-05-02 post-audit-3)

Phase 17 closes the schema-knowledge / failure-loop / cold-pool gap that
caused an observed **8-minute response** for the question "What were the
stint lengths in the British Grand Prix 2024 race session?" against the
production-data Neon warehouse on 2026-05-02. The failure mode was:
LLM hallucinated column names → SQL exec failed → repair LLM
hallucinated different column names → exec failed again → heuristic
fallback returned an irrelevant "recent sessions ordered by date" list,
all on top of a ~5-minute cold-pool resolver phase.

This plan groups every related issue uncovered during that incident
into a single phase so codex can audit the whole thing as one
roadmap rather than as scattered fixes.

## Revision 1 (2026-05-02 post-audit-1)

A first audit caught four issues + made three open-question calls:

1. **Slice 17-C wrong layer.** Validation was placed inside
   `generateSqlWithAnthropic`, but that function only calls Anthropic
   and parses JSON
   (`web/src/lib/anthropic.ts:312`). Execution and
   repair orchestration live in the route around
   `executeSqlWithTrace` (`web/src/app/api/chat/orchestration.ts:822`).
   Fix: move validation to the orchestration layer between
   generation and `executeSqlWithTrace`. The Anthropic helper stays
   focused on "generate SQL"; orchestration owns the validate →
   execute → repair → fail-honest pipeline.
2. **Slice 17-E `'timeout'` resolution status.** The current
   `ResolutionStatus` union in
   `web/src/lib/chatRuntime/resolution.ts:4` is exactly
   `"high_confidence" | "medium_confidence" | "low_confidence"`. Adding
   `'timeout'` is a type/contract change. The slice now spells out
   the type widening + downstream consumer test refresh.
3. **Cache-busting risk conflated SQL-gen and synthesis.** SQL-gen's
   call (`web/src/lib/anthropic.ts:296`) sends
   `system: systemPrompt` as a plain string with no `cache_control`;
   the existing `cache_control` block lives only on synthesis
   (`web/src/lib/anthropic.ts:103`). Slice F's prompt rebuild does
   NOT bust an existing SQL-gen cache because there is none.
   Removed from cross-cutting; left a forward-looking note that
   slice F MAY also introduce SQL-gen prompt caching as a bonus.
4. **`buildSystemPrompt()` lists 16 `core.*` contracts, not 14.**
   Re-counted: lines 56-59 of `anthropic.ts` enumerate
   `sessions, session_drivers, meetings, driver_dim,
   lap_semantic_bridge, laps_enriched, driver_session_summary,
   stint_summary, strategy_summary, grid_vs_finish,
   race_progression_summary, lap_phase_summary, telemetry_lap_bridge,
   lap_context_summary, replay_lap_frames, metric_registry`. Slice
   17-A and the audit-trail open question updated accordingly.

Open-question calls applied:

- **17-A is kept as same-day bandage** but explicitly marked
  "thrown-away mitigation, replaced by 17-F" with a hard "skip
  and go straight to 17-F" alternative if 17-A's 30-minute
  budget can't be hit before 17-F starts. The slice file's
  intro now states this so a reviser doesn't accidentally do
  hand-doc work that 17-F will discard.
- **17-D drops to ONE repair attempt** (was two). Column
  hallucinations are caught pre-exec by 17-C; non-column SQL
  errors that survive past validation rarely converge on a
  second LLM repair attempt. One attempt + honest failure is
  the right shape.
- **17-C uses `pgsql-ast-parser`** (pinned, conservative wrapper),
  not regex. Regex defeats itself silently on aliases, CTEs,
  quoted identifiers, and nested selects.

## Why this matters (the case study)

Request id `f1113280-21f2-4392-aee5-b1d17e0a99e3` (in
`web/logs/chat_query_trace.jsonl`):

| Stage | Elapsed |
|---|---|
| Cold pool + resolve_db | ~5 min |
| sqlgen_llm (Sonnet) | ~10 s |
| First exec → `column ss.compound does not exist` | <1 s |
| repair_llm (Sonnet) | ~10 s |
| Second exec → `column ss.stint_start_lap does not exist` | <1 s |
| heuristic_after_sql_failure | ~5 s |
| synthesize_llm | ~5 s |
| **Total** | **~8 min** |

Verified against Neon: `core.stint_summary` actually has columns
`compound_name`, `lap_start`, `lap_end`, `stint_length_laps` (NOT
`compound`, `stint_start_lap`, `stint_end_lap`). The LLM hallucinated
column names because the system prompt at
`web/src/lib/anthropic.ts:51-72` lists table NAMES but does not
document column names for any contract beyond `core.sessions`,
`raw.session_result`, `raw.laps`, and `raw.drivers`.

The resolver-side cold-pool (5 minutes) is the SAME issue from the
Phase 14 work that we hit on first request post-restart; pool config
in `web/src/lib/db.ts:107-114` has `idleTimeoutMillis: 30_000` and
no warm-up heartbeat.

## Repo grounding (verified 2026-05-02)

- **System prompt site**: `web/src/lib/anthropic.ts:51-72` —
  table list + only-4-tables column documentation. The LLM is
  guessing all other column names.
- **Repair prompt site**: `web/src/lib/anthropic.ts:368` (function
  `repairSqlWithAnthropic`). Repair prompt is built at
  `buildRepairPrompt()` (immediately after the system prompt).
- **Repair-loop driver**: `web/src/app/api/chat/orchestration.ts`,
  events `chat_query_first_attempt_failed` (line 826),
  `chat_query_repair_failed` (line 872), and the
  `heuristic_after_sql_failure` generationSource set at line 877.
- **Pool config**: `web/src/lib/db.ts:107-114` —
  `max: 10, idleTimeoutMillis: 30_000, statement_timeout: 15000`.
- **Existing schema-knowledge surface**: `core.metric_registry` is
  populated on Neon (30 rows verified 2026-05-02) with columns
  `metric_key, metric_name, metric_category, layer_name, grain,
  metric_status, definition, source_relation, source_columns,
  expression_hint, owner, created_at, updated_at`. **The
  `source_relation` + `source_columns` columns are exactly the
  catalog the LLM needs**, but the system prompt does not reference
  the registry as a lookup target.
- **Phase 9 split**: `web/src/lib/deterministicSql.ts` is the legacy
  monolith; the post-Phase-9 split lives at
  `web/src/lib/deterministicSql/{pace,strategy,result,telemetry,dataHealth}.ts`.
  Stint lengths fall outside the templated paths because no
  template targets `core.stint_summary` directly — that's why the
  question went to the LLM-gen path instead.

## Slice breakdown — Phase 17 (8 slices, ~2 weeks)

| # | Slice | Risk | Effort |
|---|---|---|---|
| A | `17-system-prompt-column-docs` | Low | 30 min |
| B | `17-pool-warm-and-keepalive` | Low | 1 hr |
| C | `17-pre-execute-sql-validation` | Medium | 1 day |
| D | `17-repair-loop-bounded-and-honest` | Medium | 1 day |
| E | `17-runtime-resolver-deadline` | Medium | 1 day |
| F | `17-schema-introspection-prompt-injection` | Medium | 1 day |
| G | `17-llm-gen-benchmark-coverage` | Low | 2 days |
| H | `17-tools-use-refactor` | High | 5 days |

A and B are the immediate damage-control slices. C-G are the structural
fixes. H is the long-term right-shape. F supersedes A once it lands;
A is shipped first only because it's a 30-minute fix that buys
immediate user-visible improvement.

---

### Slice 17-system-prompt-column-docs

**Thrown-away mitigation, replaced by 17-F.** Ship this only if it
can land in its 30-minute budget before slice 17-F (introspection-
based prompt) starts. If 17-F can land same-day, skip 17-A
entirely — its hand-typed column docs are deliberately discarded
when 17-F lands.

Hand-document the actual columns of every contract listed in
`buildSystemPrompt()` (`web/src/lib/anthropic.ts:51-72`). The 16
`core.*` contracts (lines 56-59) in the prompt's table list need
column lines matching the existing `raw.session_result`,
`raw.laps`, `raw.drivers`, `core.sessions` pattern.

**Steps**:
1. For each contract listed in the prompt, query
   `information_schema.columns` on Neon to get the real column names
2. Add one bullet per contract to the prompt, e.g.:
   `- core.stint_summary has: session_key, driver_number, stint_number, compound_name, lap_start, lap_end, stint_length_laps, fresh_tyre, tyre_age_at_start, avg_lap, best_lap, valid_lap_count.`
3. Update the `buildRepairPrompt()` text the same way (the repair
   prompt has the same gap)
4. Add a unit test
   `web/scripts/tests/system-prompt-schema-coverage.test.mjs` that
   parses the prompt body for `core.<table>` mentions, queries
   `information_schema` for that table's actual columns, and asserts
   each column listed in the prompt actually exists on the table

**Acceptance**:
- The "stint lengths in British GP 2024 race session" question, run
  against Neon, succeeds without going through the repair loop
- The schema-coverage unit test exits 0 against the local DB and
  Neon
- No prompt-bullet references a column that doesn't exist on its
  named table

**Out of scope**:
- Auto-generating the prompt (slice F)
- Updating the LLM model versions
- Documenting `core_build.*` (build-only schema; LLM should never
  query it directly)

### Slice 17-pool-warm-and-keepalive

Reduce cold-pool resolver latency from ~5 minutes (observed
2026-05-02) to single-digit seconds.

**Steps**:
1. `web/src/lib/db.ts:111` — bump `idleTimeoutMillis` from `30_000`
   to `300_000` (5 min) so connections survive between requests
2. Add a heartbeat: when the pool is created, register a
   `setInterval(() => pool.query('SELECT 1'), 60_000)` that fires a
   trivial query on one of the pooled connections every minute. On
   process shutdown, `clearInterval`. Behind a flag
   `OPENF1_DB_KEEPALIVE_ENABLED` (default `true` in production,
   `false` for tests so test suites don't leak timers)
3. On first chatRuntime invocation per process, fire a "pool warm"
   query (`SELECT 1`) before the user's resolver queries — eliminates
   the first-request-pays-cold-start tax
4. Document in `web/.env.local.example`:
   `OPENF1_DB_KEEPALIVE_ENABLED=true` for production, false for tests

**Acceptance**:
- After the first request, subsequent requests within 5 minutes
  produce `runtimeMs` < 5 seconds (was 22-60 seconds during the
  2026-05-02 incident, observed in the dev log directly after pool
  cold-start)
- A unit test asserts the keepalive interval is registered when
  `OPENF1_DB_KEEPALIVE_ENABLED=true` and is NOT registered in test
  environment
- The trace `runtime_classify` span shows < 100 ms (pure JS) and
  the `resolve_db` span shows < 5 s on a warm pool

**Out of scope**:
- Neon endpoint suspend-timeout configuration (an ops change, not a
  code change)
- Connection-pool resizing — `max: 10` stays
- Switching from `pg` to a Neon-specific HTTP driver

### Slice 17-pre-execute-sql-validation

Before sending generated SQL to `pool.query`, parse it and validate
that every `<table>.<column>` reference exists in
`information_schema.columns`. If a hallucinated column is detected,
skip the exec and short-circuit to repair (with the actual column
list passed in the repair prompt) rather than waiting for the DB to
return the error.

**Layering**: validation lives in the **orchestration layer** —
between `generateSqlWithAnthropic` and `executeSqlWithTrace`
(`web/src/app/api/chat/orchestration.ts:822`), NOT inside
`generateSqlWithAnthropic` itself. The Anthropic helper at
`web/src/lib/anthropic.ts:312` only generates and parses; the
route owns the validate → execute → repair → fail-honest
pipeline. This keeps responsibilities crisp: `anthropic.ts` does
LLM I/O, the orchestration owns SQL execution policy.

**Steps**:
1. New module `web/src/lib/sqlValidation/columnExistenceCheck.ts`
   that takes a SQL string + the catalog (cached
   `information_schema` snapshot from slice F if present, else
   live query) and returns
   `{ ok: true } | { ok: false, missing: [{table, column, sourceRef}] }`,
   where `sourceRef` is the original alias-qualified form
   (e.g. `ss.compound`) for telemetry/repair-prompt readability.
2. **SQL parsing**: use `pgsql-ast-parser` (pinned exact-version
   in `package.json`; MIT license; ~2k weekly downloads as of
   2026-05-02). Wrap conservatively: on any parse exception, log
   `column_validation_parser_failed` and default to `ok: true` so
   the DB still catches the error (parser bugs must NOT block
   valid SQL). Regex-based parsing is explicitly rejected —
   aliases, CTEs, quoted identifiers, and nested selects defeat
   regex silently and we'd ship a checker that misses real bugs.
3. **Build a table-alias map from FROM / JOIN clauses, then
   resolve every column reference through it.** This is the
   actual hard part of the validator and the failure mode the
   2026-05-02 incident exhibited:
   `FROM core.stint_summary ss ... SELECT ss.compound` — the
   bare-table validator catches `compound` not existing on a
   table called `ss` and either misses the real bug (if it
   ignores unknown aliases) or false-positives (if it treats
   `ss` as a real table name). Concrete requirements:
   - Walk the FROM clause and every JOIN, collecting
     `{ alias, schema, table }` tuples. Aliases include explicit
     forms (`FROM core.stint_summary AS ss` and
     `FROM core.stint_summary ss`) and the implicit form where
     the alias equals the unqualified table name (`FROM core.stint_summary`
     → alias `stint_summary`).
   - For every column reference in **every clause that can name a
     column** — `SELECT`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`,
     **and `JOIN ... ON`** — resolve its prefix:
     - `ss.compound` → look up `ss` in the alias map → resolve
       to `core.stint_summary` → check `compound` against
       `core.stint_summary`'s columns from `information_schema`
     - `compound` (unqualified, single-table FROM) → resolve to
       the single FROM-clause table
     - `compound` (unqualified, multi-table FROM) → ambiguous;
       skip this reference (let DB catch it; don't false-positive)
     - `subq.compound` where `subq` is a CTE / subquery alias →
       skip (the CTE's columns are derived, not from
       `information_schema`)
   - On any reference whose resolved `(table, column)` pair is
     not in the catalog, emit it in `missing` with the original
     alias-qualified `sourceRef` preserved.
4. **Wire into orchestration** (`web/src/app/api/chat/orchestration.ts`,
   the block around line 822 where the first SQL exec happens):
   after `generateSqlWithAnthropic` returns SQL but before
   `executeSqlWithTrace`, call the validator. On miss, route to
   `repairSqlWithAnthropic` with the missing-column list spliced
   into the repair prompt (e.g.
   `"Your SQL referenced ss.compound, but core.stint_summary has no
   column 'compound'. Available columns on core.stint_summary:
   compound_name, lap_start, lap_end, stint_length_laps, ..."`);
   the existing `chat_query_first_attempt_failed` event fires for
   telemetry parity. Do NOT call into the repair path twice —
   slice 17-D caps repair attempts at 1.
5. Telemetry: log `column_validation_failed` events with the
   missing-column list (including alias-qualified `sourceRef`) to
   perfTrace so we can measure how often the LLM hallucinates and
   which contracts trip it most.

**Acceptance**:
- **Incident-replay fixture** (mandatory): the exact SQL from the
  2026-05-02 incident, normalized:
  ```sql
  SELECT ss.driver_number, ss.stint_number, ss.compound,
         ss.stint_start_lap, ss.stint_end_lap, ss.stint_lap_count
  FROM core.stint_summary ss
  WHERE ss.session_key = 9662
  ```
  Validator must return
  `{ ok: false, missing: [
    { table: 'core.stint_summary', column: 'compound', sourceRef: 'ss.compound' },
    { table: 'core.stint_summary', column: 'stint_start_lap', sourceRef: 'ss.stint_start_lap' },
    { table: 'core.stint_summary', column: 'stint_end_lap', sourceRef: 'ss.stint_end_lap' },
    { table: 'core.stint_summary', column: 'stint_lap_count', sourceRef: 'ss.stint_lap_count' }
  ] }`. This is the exact failure class Phase 17 was opened to fix;
  the test must pass byte-for-byte on this input.
- **Alias-form coverage fixtures** (executable SQL):
  - `SELECT ss.compound FROM core.stint_summary AS ss` →
    catches `ss.compound` as missing, resolved to
    `core.stint_summary`
  - `SELECT ss.compound FROM core.stint_summary ss` (no AS) →
    same result
  - `SELECT compound FROM core.stint_summary` (no alias) →
    catches `compound` as missing on the implicit-aliased table
  - `SELECT ss.compound, sd.full_name FROM core.stint_summary ss
    JOIN core.session_drivers sd ON ss.session_key = sd.session_key`
    → catches `ss.compound` only (`sd.full_name` is real on
    `core.session_drivers`)
- **JOIN-ON predicate fixtures** (mandatory — column hallucination
  can appear in JOIN predicates and is still column-existence
  validation, not JOIN semantics):
  - `SELECT ss.compound_name FROM core.stint_summary ss
    JOIN core.session_drivers sd
    ON ss.fake_driver = sd.driver_number` → catches
    `ss.fake_driver` as missing on `core.stint_summary`
  - `SELECT ss.compound_name FROM core.stint_summary ss
    JOIN core.session_drivers sd
    ON ss.session_key = sd.bogus_key` → catches `sd.bogus_key`
    as missing on `core.session_drivers`
  - `SELECT ss.compound_name FROM core.stint_summary ss
    LEFT JOIN core.session_drivers sd
    ON ss.session_key = sd.session_key
    AND sd.invalid_col IS NOT NULL` → catches `sd.invalid_col`
    as missing (compound JOIN predicate)
- **Negative coverage**: a valid query
  `SELECT ss.compound_name, ss.lap_start, ss.stint_length_laps
  FROM core.stint_summary ss` returns `{ ok: true }` (no
  false-positive on the correct columns).
- **CTE / subquery alias skip**: a query with a CTE
  (`WITH foo AS (SELECT ...) SELECT foo.x FROM foo`) does NOT
  emit `foo.x` as missing — the validator skips refs whose
  prefix resolves to a derived alias, not a real table.
- The total-request-time on hallucinated-column failures drops
  from the observed ~25-30 s (sqlgen + exec-fail + repair +
  exec-fail) to ~15-20 s (sqlgen + validate + repair + exec-success).
- Hand-crafted regression test: a question whose templated answer
  is "use `core.stint_summary` for stint lengths" should generate
  SQL referencing `compound_name`/`lap_start`/`lap_end`/`stint_length_laps`
  on the first try (because the repair prompt now includes the
  actual columns).

**Out of scope**:
- Validating non-column expressions (function names, return-type
  inference)
- Validating SQL semantics (e.g. JOIN correctness, type
  compatibility)
- Validating CTE / subquery internal columns (only resolves the
  outer-query references through their alias map; CTE-internal
  refs are out of scope)
- Re-executing the validated SQL against a sandboxed parser to
  catch other classes of error

### Slice 17-repair-loop-bounded-and-honest

Today's repair loop:
- 1 LLM call → exec → 1 repair LLM call → exec → heuristic_fallback

Each step has no time bound; the heuristic_fallback returns a
defensive-shape result that doesn't address the question. Replace
with a bounded loop that fails honestly on exhaustion.

**Steps**:
1. `web/src/app/api/chat/orchestration.ts` (the lines around 826,
   872, 877) — refactor to:
   - **max 1 repair attempt** (revised from 2 in rev0; with 17-C
     catching column hallucinations pre-exec, the only repair
     scenarios left are non-column SQL errors, and a second LLM
     attempt at those rarely converges)
   - max 60 s wall-clock for the SQL-gen + validate + exec + repair
     cycle
   - on exhaustion, return a structured "I couldn't construct a
     valid SQL query for this question. The query I tried referenced
     columns that don't exist on the targeted contract." error
     instead of the heuristic fallback
2. The heuristic_after_sql_failure path is removed for the SQL-error
   case. It stays for the timeout case (where SQL was syntactically
   valid but ran too long) — a different defensive use that's
   actually appropriate
3. Surface the actual SQL error in the `chat_request_received`
   trace's notes/details block so it's user-visible in the dev UI
   (the screenshot from 2026-05-02 showed the user got a misleading
   "no stint length data was returned" answer when the real cause
   was column mismatch)

**Acceptance**:
- A test that forces hallucinated columns + asserts the response is
  the structured error, NOT the recent-sessions list
- Total wall-clock for SQL-gen + repair-cycle is bounded at 60s
- The chat-route response shape adds a `sql_error?: string` field;
  consumers (existing chat UI, healthcheck) MUST be updated to
  display it when present (this IS a contract change; tests refresh
  fixtures accordingly)

**Out of scope**:
- LLM-side hint that "this is your last attempt, give up gracefully"
  — too much prompt engineering for the value
- Adding more repair attempts. Two attempts at most; if those don't
  converge, the LLM doesn't know enough about the schema and we
  should not keep trying

### Slice 17-runtime-resolver-deadline

The resolver path (chatRuntime → `core.session_search_lookup`,
`core.driver_identity_lookup`) sometimes runs 22-60+ seconds when
the pool is cold (observed 2026-05-02). With 17-pool-warm-and-keepalive
in place this should drop to < 5 s, but unbounded resolution can
still hang on a degraded Neon endpoint.

**Steps**:
1. **Type / contract widening**: the current `ResolutionStatus`
   union in `web/src/lib/chatRuntime/resolution.ts:4` is
   `"high_confidence" | "medium_confidence" | "low_confidence"`.
   Two implementation choices, slice picks (a) for simplicity:
   - **(a)** Widen the union to add `"timeout"` and update every
     consumer that exhausts the union via `switch` or
     `if/else if` chains. Audit-trail: add a one-line note
     to `_state.md` Notes for auditors saying
     `ResolutionStatus` is now a 4-member union.
   - **(b)** Keep the union at 3 members and add a parallel
     `resolution.timedOut: boolean` flag. Less type churn but
     two fields to keep in sync.
   The slice author picks (a) and updates the ~5 consumer sites
   plus tests; the orchestration's `runtime_clarification` branch
   already handles the "needs clarification" return shape.
2. Wrap the `resolve_db` span body with a `Promise.race` against
   `setTimeout(reject, 30_000)` — 30 s hard cap
3. On timeout: log `chat_resolve_timeout`, set
   `resolution.status = 'timeout'` and
   `resolution.needsClarification = true`, populate
   `resolution.clarificationPrompt` with "I couldn't resolve
   session/driver references within the time budget. Please
   rephrase or include explicit session_key / driver_number."
4. Add the timeout count to `_state.md`'s observability section
   (Phase 16-1 aggregator) so we can monitor

**Acceptance**:
- A test that mocks the resolver SQL to hang asserts the route
  returns a clarification within 31 seconds
- No regression in the curated 50-question benchmark (which never
  hits the 30s deadline on a warm pool)

**Out of scope**:
- Per-query timeouts on individual resolver SQL calls
- Cancelling in-flight queries (Postgres connection-level cancel
  is brittle); the wrapper just rejects the JS promise

### Slice 17-schema-introspection-prompt-injection

Replace the hand-typed column documentation in
`buildSystemPrompt()` (`web/src/lib/anthropic.ts:51-72`) with
runtime introspection. At process boot, query
`information_schema.columns` for the listed contracts, build the
schema-docs section programmatically, cache it in a module-level
variable for the process lifetime.

**Steps**:
1. New module `web/src/lib/schemaCatalog.ts`:
   - `getSchemaDocs(): Promise<string>` returns the formatted
     schema-docs section
   - On first call, queries `information_schema.columns` for the
     hardcoded list of contract tables (the same list the prompt
     mentions today)
   - Caches in a module-scope `Promise<string>` so concurrent
     callers share one query
   - Optionally also pulls from `core.metric_registry` (which has
     `source_relation` + `source_columns`) for human-curated
     metric descriptions
2. `buildSystemPrompt()` becomes async, awaits `getSchemaDocs()`,
   splices the result in. The static-prefix portion of the system
   prompt (rules, JSON format) stays cacheable separately
3. Make `generateSqlWithAnthropic` and `repairSqlWithAnthropic`
   async-await the prompt build
4. After this slice, slice A's hand-typed column docs are removed

**Acceptance**:
- `getSchemaDocs()` returns a formatted string matching the schema
  test from slice A
- Adding a column to any of the listed contracts on Neon and
  restarting the dev server (no code change) makes the column
  available to the LLM
- A schema-introspection test confirms the docs include columns
  added in Phase 13's `022_session_result_extend_columns` migration
  (`number_of_laps`, `duration`, `gap_to_leader`)

**Out of scope**:
- Live-refresh during a process lifetime (pool warm-up rebuilds it
  on next process start; that's enough for v1)
- Validating that every prompt-listed contract actually exists on
  the target DB (the prompt's table list stays hand-maintained;
  schema docs are just the columns)

### Slice 17-llm-gen-benchmark-coverage

The 50-question curated benchmark in
`web/scripts/chat-health-check.questions.json` doesn't cover
LLM-gen-path questions on the contracts that hallucinate. Add a
dedicated suite that exercises every templatable contract via the
LLM-gen path so this class of failure is caught at PR-time.

**Steps**:
1. New benchmark file
   `web/scripts/chat-health-check.questions.llm_contracts_2026-05-02.json`
   with one question per `core.*` contract that's typically queried
   via LLM-gen:
   - core.stint_summary: "What were the stint lengths in the British
     Grand Prix 2024 race session?"
   - core.strategy_summary: "What was the overall race strategy at
     Spa 2024?"
   - core.grid_vs_finish: "How many positions did each driver gain
     or lose at Monza 2024?"
   - (etc., ~12 questions total)
2. Run via existing `npm run healthcheck:chat -- --questions <path>`
3. Acceptance: every question in this suite returns a non-error
   answer with `factual_correctness >= B` under the multi-axis
   grader
4. Wire into the loop's `test_grading_gate.sh` so future PRs that
   change the schema or the prompt are gated against this suite

**Acceptance**:
- Benchmark file lands with 12 questions
- After 17-A and 17-C ship, the suite's
  factual_correctness A-rate is ≥ 80%
- Suite is invokable via the standard healthcheck flow

**Out of scope**:
- Per-driver / per-venue parameterization (those go in the variant
  benchmark Phase 14-H)
- Performance assertions (latency caps); just correctness for now

### Slice 17-tools-use-refactor

Replace the monolithic system prompt with Anthropic's tools-use
pattern. The LLM gets tools like `describe_table(name)`,
`list_tables(schema)`, and `sample_rows(table, n)`. Eliminates the
prompt-staleness class of bug entirely.

**Steps**:
1. Define the tool schema (TypeScript types + Anthropic API
   `tools` field)
2. Implement each tool's server-side handler against
   `information_schema` and the live DB (with row-count and
   row-size caps to prevent runaway)
3. Refactor `generateSqlWithAnthropic` to use the tools loop:
   send messages, handle tool calls, return final SQL
4. Update tests; expand the LLM-contracts benchmark to cover
   tools-path questions

**Acceptance**:
- Stint-summary question succeeds via tools-use without any
  hand-typed column docs in the prompt
- Average tool calls per request ≤ 3 (don't let the LLM over-use
  the tools)
- Latency parity with the single-shot path on the curated suite
  (tools-use can be slightly slower; budget +30%)

**Out of scope**:
- Replacing the synthesis call with tools-use (different shape)
- Streaming the tool-call loop to the user

---

## Cross-cutting concerns

### Telemetry that needs to land alongside

- New perfTrace event types: `column_validation_failed`,
  `repair_attempt`, `repair_exhausted`, `resolve_db_timeout`,
  `pool_warm_query_started`. Each one's count and elapsed should
  flow through Phase 16-1's aggregator.

### Migration ordering

Phase 17 depends on Phase 13's `022_session_result_extend_columns`
migration being deployed (so 17-F's introspection picks up
`number_of_laps` / `duration` / `gap_to_leader`). It does NOT
depend on Phase 13's data backfill — empty tables introspect fine.

### Cache-busting risk — N/A for SQL-gen today

The rev0 plan claimed slice F would invalidate Anthropic
prompt-cache on the SQL-gen path. **This is wrong**: SQL-gen sends
`system: systemPrompt` as a plain string with no `cache_control`
block (`web/src/lib/anthropic.ts:296`). The
`cache_control: { type: "ephemeral" }` block exists only on the
synthesis path (`web/src/lib/anthropic.ts:103-111`), which slice F
does not touch. Slice F's prompt rebuild therefore does NOT bust
any existing cache.

**Forward note**: as a follow-up after slice F, SQL-gen MAY also
adopt prompt-prefix caching (parallel to synthesis). If/when that
happens, the schema-docs section should be split into a separate
cache block from the rules/format block so schema migrations only
bust the schema-docs cache, not the rules cache. That's an
optimization slice for later, not a Phase 17 deliverable.

### Out of scope (separate efforts)

- Neon endpoint configuration (suspend timeout, autoscaling) —
  that's an ops change tracked elsewhere.
- Replacing `pg.Pool` with a serverless-native driver (e.g.
  `@neondatabase/serverless` over HTTP). Substantial refactor;
  evaluate after measuring the warm-pool baseline from 17-B.
- Tools-use migration for the synthesis prompt as well — Phase 17
  scopes tools-use to SQL-gen only.

---

## Acceptance — what success looks like end-to-end

After Phase 17 lands:

| Metric | Before | Target |
|---|---|---|
| Stint-summary question total time | ~8 min | ≤ 15 s |
| Cold-pool first-request latency | ~5 min | ≤ 10 s (with warm-up) |
| LLM column-hallucination rate (per LLM-gen request) | ~30% (estimated from incident logs) | ≤ 5% |
| Heuristic-fallback "garbage answer" rate | unknown | 0 (replaced by honest error) |
| LLM-contracts benchmark factual_correctness A | n/a | ≥ 80% |
| Curated benchmark factual_correctness A | 50/50 | unchanged |
| Repair-loop max wall-clock | unbounded | 60 s hard cap |
| Resolver max wall-clock | unbounded | 30 s hard cap |

The four user-visible failure modes the 2026-05-02 incident
exposed (long cold-start, column hallucination, repair-loop
infinite-loop-with-different-mistakes, and misleading heuristic
fallback) all close.

## What this does NOT solve

- **Data coverage**: Phase 17 does not load `raw.session_result` /
  `raw.starting_grid` data. That's still Phase 13's runbook.
- **Resolver brittleness on casual phrasing**: Phase 14's alias
  resolver work is the answer there; Phase 17 only fixes the
  SQL-execution phase, not entity resolution.
- **Real production-traffic measurement**: still depends on Phase
  16's prod sampling. Phase 17's benchmark gate is a PR-time
  guardrail, not a production-traffic monitor.

## Audit-trail / decisions log

The rev1 audit closed all three rev0 open questions:

- **Skip 17-A vs ship it as bandage**: ship 17-A only if it lands
  in its 30-minute budget before 17-F starts; explicitly marked
  "thrown-away mitigation" in the slice intro.
- **17-D repair attempts**: dropped from 2 to 1. With 17-C
  catching column hallucinations pre-exec, the residual
  non-column SQL errors rarely converge on a second attempt.
- **17-C SQL parser**: `pgsql-ast-parser` (pinned exact-version,
  conservative wrap on parse exceptions). Regex-based parsing
  rejected — defeats itself silently on aliases / CTEs / quoted
  identifiers / nested selects.

## Revision 2 (2026-05-02 post-audit-2)

A second audit caught one critical gap in slice 17-C:

- **Validator must explicitly resolve table aliases.** The 2026-05-02
  incident SQL was alias-qualified
  (`FROM core.stint_summary ss ... SELECT ss.compound`), not bare
  table-qualified. The rev1 plan said "validate every
  `<table>.<column>` reference", which a reviser could implement as
  "look up `ss` in `information_schema`, find no table called `ss`,
  skip" — silently missing the exact failure class Phase 17 exists
  to fix. Rev2 makes alias-map construction an explicit Step 3 with
  concrete resolution rules (explicit `AS`, implicit alias, multi-
  table FROM ambiguity, CTE/subquery skip), and adds an
  **incident-replay fixture** to acceptance that asserts the exact
  rows the validator must catch from the production incident SQL.

No open questions remain at rev2.

## Revision 3 (2026-05-02 post-audit-3)

A third audit caught two issues in slice 17-C:

- **JOIN ... ON predicates were excluded from the validation
  scope** (rev2's Step 3 listed `SELECT / WHERE / GROUP BY /
  HAVING / ORDER BY` only). Hallucinated columns can appear in
  join predicates too, and that's still column-existence
  validation, not JOIN semantics. Step 3 now explicitly includes
  `JOIN ... ON` in the clause list, and three JOIN-ON predicate
  fixtures are added to acceptance:
  - alias-qualified column missing on left side of `=`
  - alias-qualified column missing on right side of `=`
  - missing column in a compound `AND`-joined ON predicate
- **Alias-form fixture SQL was malformed shorthand**
  (`FROM ... SELECT ...` instead of executable `SELECT ... FROM ...`).
  Fixtures now use real executable SQL ordering so the slice
  implementer can paste them directly into the test runner without
  guessing.

No open questions remain at rev3.
