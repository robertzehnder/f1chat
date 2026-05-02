# Phase 17 — LLM SQL-Gen Robustness Plan — 2026-05-02

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

Hand-document the actual columns of every contract listed in
`buildSystemPrompt()` (`web/src/lib/anthropic.ts:51-72`). The 14
`core.*` contracts in the prompt's table list need column lines
matching the existing `raw.session_result`, `raw.laps`, `raw.drivers`,
`core.sessions` pattern.

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

**Steps**:
1. New module `web/src/lib/sqlValidation/columnExistenceCheck.ts`
   that takes a SQL string + the catalog (cached
   `information_schema` snapshot from slice F if present, else
   live query) and returns `{ ok: true } | { ok: false, missing: [{table, column}] }`
2. Use a lightweight SQL parser (e.g.
   [`pgsql-ast-parser`](https://www.npmjs.com/package/pgsql-ast-parser),
   2k weekly downloads, MIT license) to extract column references.
   Conservative on parse failure — if the parser fails, default to
   `ok: true` and let the DB catch the error (don't block valid
   SQL on parser bugs)
3. Wire into `generateSqlWithAnthropic` (`web/src/lib/anthropic.ts`):
   after the LLM returns SQL but before exec, run validation. If
   missing columns, immediately invoke repair with the missing-column
   list spliced into the repair prompt
4. Telemetry: log `column_validation_failed` events to perfTrace so
   we can measure how often the LLM hallucinates

**Acceptance**:
- Hand-crafted regression test: a question whose templated answer
  is "use `core.stint_summary` for stint lengths" should generate
  SQL referencing `compound_name`/`lap_start`/`lap_end`/`stint_length_laps`
  on the first try (because the repair prompt now includes the
  actual columns)
- A unit-test fixture asserts the validator catches `compound`,
  `stint_start_lap`, `stint_end_lap` as missing on `core.stint_summary`
- The total-request-time on hallucinated-column failures drops from
  the observed ~25-30 s (sqlgen + exec-fail + repair + exec-fail)
  to ~15-20 s (sqlgen + validate + repair + exec-success)

**Out of scope**:
- Validating non-column expressions (function names, aliases)
- Validating SQL semantics (e.g. JOIN correctness)
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
   - max 2 repair attempts
   - max 60 s wall-clock for the SQL-gen + exec + repair cycle
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
1. Wrap the resolve_db span body with a `Promise.race` against
   `setTimeout(reject, 30_000)` — 30 s hard cap
2. On timeout: log `chat_resolve_timeout`, set
   `resolution.status = 'timeout'`, return a clarification prompt
   ("I couldn't resolve session/driver references within the time
   budget. Please rephrase or include explicit session_key /
   driver_number.")
3. Add the timeout count to `_state.md`'s observability section
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

### Cache-busting risk

The system prompt is currently part of the Anthropic prompt-cache
(see `web/src/lib/synthesis/buildSynthesisPrompt.ts`). Slice F's
introspection-based prompt will produce slightly different bytes on
each schema change → cache invalidation. Mitigation: keep the
schema-docs section as a separate cacheable block from the
rules/format block; only the schema-docs cache busts when the
schema changes. Document this trade-off in the slice file.

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

## Audit-trail / open questions for the reviewer

- Should slice 17-A be skipped entirely in favor of 17-F directly?
  (Tradeoff: 17-A is 30 minutes, 17-F is a day. If we ship 17-F
  first there's no point in 17-A. But 17-A can land TODAY and stop
  the bleeding while 17-F is built.)
- Should the bounded-repair slice (17-D) keep TWO repair attempts
  or drop to ONE? The reasoning in the slice body says two; an
  argument for one is that the second attempt rarely converges if
  the first failed for column-name reasons (which 17-C catches
  pre-execute anyway).
- Is `pgsql-ast-parser` (slice 17-C) acceptable as a new dep, or
  should the parsing be done with a hand-written regex pass?
  Hand-written is more brittle but has zero dependency surface.

These three are flagged for codex's audit — pick whichever lens
seems most defensible and the reviser will revise toward it.
