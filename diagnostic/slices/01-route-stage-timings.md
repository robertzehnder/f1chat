---
slice_id: 01-route-stage-timings
phase: 1
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T10:00:00-04:00
---

## Goal
Wire the per-stage perf-trace helpers (built in `01-perf-trace-helpers`) into the chat route so every request — including early-return and error-path exits — emits a structured stage-timing record covering the stages that actually fired on that request's code path.

## Inputs
- `web/src/lib/perfTrace.ts` — span helpers from prior slice (`startSpan`, `Span.end`, `flushTrace`)
- `web/src/app/api/chat/route.ts` — chat endpoint
- [roadmap §4 Phase 1](../roadmap_2026-04_performance_and_upgrade.md)

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, recent merges, accumulated auditor notes.
- `diagnostic/slices/01-perf-trace-helpers.md` — defines the `startSpan` / `Span.end` / `flushTrace` API this slice integrates with. The acceptance criteria here must match what that slice actually exported.
- `web/src/lib/perfTrace.ts` — confirms the exported signatures: `startSpan(name): Span`, `Span.end(): SpanRecord`, `flushTrace(requestId, spans: SpanRecord[]): Promise<void>`. `flushTrace` writes to `web/logs/chat_query_trace.jsonl`.
- The chat route at `web/src/app/api/chat/route.ts` to confirm the actual stage boundaries (and the existing `appendQueryTrace` writes to the same JSONL file) before writing the test.

## Required services / env
None. The route's runtime path uses Postgres + Anthropic, but the gate test does NOT invoke the route — it does static analysis on the route source (see Steps step 5). No env vars or live services are required for `npm run build`, `npm run typecheck`, or `npm run test:grading` to pass.

## Steps
1. Import `startSpan`, `flushTrace`, and the `SpanRecord` type from `@/lib/perfTrace` into `web/src/app/api/chat/route.ts`.
2. Stage names — use exactly these 10 from `perfTrace.ts`: `request_intake`, `runtime_classify`, `resolve_db`, `template_match`, `sqlgen_llm`, `execute_db`, `repair_llm`, `synthesize_llm`, `sanity_check`, `total`. All 10 stage names must appear as `startSpan("<stage>")` call sites in `route.ts` — there is no combined-span exception. Wire each stage at the corresponding code site:
   - `request_intake` — body parse + validation block (started right after `requestId` is generated; ended after the message-presence check, before `buildChatRuntime`).
   - `runtime_classify` — wrap the question-type classification step. Since `buildChatRuntime` performs both classification and DB resolution internally, this slice cannot separate them in time. Start BOTH `runtime_classify` and `resolve_db` immediately before the `buildChatRuntime` call, await `buildChatRuntime`, then end BOTH spans after it resolves. The two spans therefore cover the same window and will record essentially the same `elapsedMs`; this is acknowledged duplication and is the explicit intent of the slice. Splitting `buildChatRuntime` so the two stages can be measured independently is out of scope (see "Out of scope"). A one-line code comment at the call site must note that both spans wrap the shared call.
   - `resolve_db` — see above; started immediately before `buildChatRuntime` (alongside `runtime_classify`) and ended after the call resolves (alongside `runtime_classify`). Both spans are open concurrently, not back-to-back.
   - `template_match` — the `buildDeterministicSqlTemplate` call.
   - `sqlgen_llm` — the `generateSqlWithAnthropic` call (only on the LLM-generation branch).
   - `execute_db` — each `runReadOnlySql` invocation inside `executeSqlWithTrace`.
   - `repair_llm` — the `repairSqlWithAnthropic` call (only on the repair branch).
   - `synthesize_llm` — the `synthesizeAnswerWithAnthropic` call (only when `result.rowCount > 0`).
   - `sanity_check` — the `applyAnswerSanityGuards` call (only when `result.rowCount > 0`).
   - `total` — started at the top of `POST` (right after `requestId` is generated) and ended in the finally block (see step 4).
3. Span lifecycle (corrects the prior wording): `startSpan(name)` returns a `Span`; calling `span.end()` returns a `SpanRecord` (`{ name, startedAt, elapsedMs }`). Accumulate every returned `SpanRecord` into a single `SpanRecord[]` array scoped to the request. Pass that array (not active `Span` objects) to `flushTrace(requestId, records)`.
4. Trace must flush on every exit covered by the goal. Open the outer `try { ... } finally { ... }` immediately after `requestId` is generated (before the body-parse `try`/`catch` and before the missing-`message` early return), and start `total` inside that try as the first action. The finally must therefore run on every one of these exits:
   - Invalid-JSON early return (status 400 from the body-parse `catch`).
   - Missing-`message` early return (status 400 from the message-presence check).
   - Clarification-required early return.
   - Completeness-blocked early return.
   - Successful response.
   - Transient DB unavailability branch (`isTransientDatabaseAvailabilityError`).
   - Generic error catch.
   In the finally block: end any still-open spans (defensively — `Span.end()` is idempotent), end `total`, then `await flushTrace(requestId, spans)`. Wrap the `flushTrace` call in its own try/catch that logs to stderr only — trace-write failures must not change the response status (existing `appendQueryTrace` already swallows; mirror that behavior). Note: on the invalid-JSON exit only the `request_intake` and `total` spans will have been started, so the flushed record will contain just those two; that is intentional, not a regression.
5. Coexistence with the existing `appendQueryTrace` writes to `web/logs/chat_query_trace.jsonl`: both writers append to the same file. The new perfTrace records are uniquely identified by the top-level `spans: SpanRecord[]` array (existing `appendQueryTrace` records do not include a `spans` field — they carry `status`, `queryPath`, `sql`, etc.). Tests and downstream consumers MUST filter by `Array.isArray(entry.spans)` to isolate the structured stage-timing records. Do not change the file path, and do not remove or reshape the existing `appendQueryTrace` entries — they continue to coexist.
6. Add a static-analysis test at `web/scripts/tests/route-trace.test.mjs` (matching the `web/scripts/tests/*.test.mjs` pattern used by `01-perf-trace-helpers` so it is picked up by `npm run test:grading`). The test reads `web/src/app/api/chat/route.ts` as text and asserts:
   - The file imports `startSpan` and `flushTrace` from `@/lib/perfTrace` (regex on the import statement).
   - For each of the 10 stage names, at least one `startSpan("<stage>")` (or `startSpan('<stage>')`) call appears in the source.
   - At least one `flushTrace(` call appears in the source.
   - At least one `} finally {` block appears in the source (sanity check that flushing is set up to run on all exits — not airtight but cheap).
   The static-analysis approach is deliberate: it covers all conditional branches without needing live Postgres or Anthropic, and it is robust to stages that only fire on one code path. Branch-execution coverage is left to `01-baseline-snapshot`, which exercises the route with real services and produces the first promoted JSONL artifact.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/scripts/tests/route-trace.test.mjs`
- `diagnostic/slices/01-route-stage-timings.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
None for this slice; runtime trace lines land in `web/logs/chat_query_trace.jsonl` (dev sink only). The first promoted baseline is produced by `01-baseline-snapshot`.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Imports of `startSpan` and `flushTrace` from `@/lib/perfTrace` resolve at typecheck time in `route.ts`.
- [ ] Each of the 10 stage names from step 2 appears in at least one `startSpan("<stage>")` call site in `route.ts` (verified by the static-analysis test). All 10 are required — no combined-span exception. `runtime_classify` and `resolve_db` are both started immediately before `buildChatRuntime` and both ended after it resolves (concurrent spans wrapping the same call), with a one-line code comment noting the shared call.
- [ ] `route.ts` calls `flushTrace(requestId, spans)` from a `finally` block whose `try` opens immediately after `requestId` is generated, so every exit path — invalid-JSON, missing-message, clarification, completeness-blocked, success, transient-db-unavailable, generic error — flushes exactly once.
- [ ] `flushTrace` is invoked with a `SpanRecord[]` (the values returned by `Span.end()`), not active `Span` objects.
- [ ] The existing `appendQueryTrace` JSONL writes are unchanged in shape and file path; perfTrace records are distinguishable by the top-level `spans` array.
- [ ] `web/scripts/tests/route-trace.test.mjs` exists, is executed by `npm run test:grading`, and asserts the four conditions in step 6.
- [ ] All gates exit 0.

## Out of scope
- The /api/admin/perf-summary route (separate slice `01-perf-summary-route`).
- Capturing baseline traces (`01-baseline-snapshot`).
- Branch-execution coverage of the route under real services (also `01-baseline-snapshot`).
- Refactoring `buildChatRuntime` to physically separate the classification and DB-resolution work — this slice keeps `runtime_classify` and `resolve_db` as adjacent spans wrapping the shared call.

## Risk / rollback
Rollback: `git revert <commit>`. The trace file is dev-sink only; no persistent state is at risk. `flushTrace` failures are swallowed (mirroring `appendQueryTrace`), so a regression in trace-writing cannot change response status codes.

## Slice-completion note

- Branch: `slice/01-route-stage-timings` (forked from `integration/perf-roadmap` @ `84ee03f`).
- Commits:
  - `7062b45` — Wire perfTrace stage spans into the chat route (route.ts + new static-analysis test).
  - `e974c30` — Fill slice-completion note and flip frontmatter to `awaiting_audit` / owner `codex`.
  - `0f2886c` — audit: revise (REVISE verdict appended noting repair-fallback regression).
  - `455e6f3` — Restore repair fallback semantics: re-wrap `repair_llm` LLM call + `repair_retry` execution in a single outer try/catch so a `repair_retry` execution failure once again logs `chat_query_repair_failed` and falls back to `heuristic_after_sql_failure`. The `repair_llm` span remains scoped strictly to the `repairSqlWithAnthropic` call via an inner try/finally that ends the span before the retry runs.
  - `622a17a` — Record revision commit hash in slice-completion note (round-1 follow-up).
  - `ccebbaa` — audit: revise (round-2 REVISE verdict appended noting `totalSpan` initialized outside the outer try).
  - `3da753b` — Move `totalSpan` initialization inside the outer try as its first action (round-2 REVISE fix). Declare `let totalSpan: Span | null = null` before the outer try; assign `totalSpan = startTrackedSpan(startSpan("total"))` as the first statement inside the try; guard `openSpans.delete(totalSpan)` and `traceRecords.push(totalSpan.end())` in the finally with `if (totalSpan)`.
- Files changed (matches "Changed files expected"):
  - `web/src/app/api/chat/route.ts` — modified.
  - `web/scripts/tests/route-trace.test.mjs` — new (~55 LOC).
  - `diagnostic/slices/01-route-stage-timings.md` — frontmatter + this note (loop-protocol file, implicitly allowed).
- Implementation decisions:
  - Trace-state plumbing: `traceRecords: SpanRecord[]` and `openSpans: Set<Span>` are declared at the top of `POST` (before the outer try) so the `finally` block can defensively end any spans that were left open by an exceptional inner exit. `startTrackedSpan` registers a fresh span in `openSpans`; `endTrackedSpan` removes from `openSpans` and pushes the resulting `SpanRecord` once. `Span.end()` is idempotent in `perfTrace.ts`, but `endTrackedSpan` guards against duplicate entries via `openSpans.delete(span)`.
  - Outer `try { ... } finally { ... }` opens immediately after `requestId = crypto.randomUUID()` (and after the trace-state declarations), with `startSpan("total")` as the first action inside the try. Every documented exit path — invalid-JSON 400, missing-message 400, clarification 200, completeness-blocked 200, success 200, transient-db-unavailable 200, and generic-error 400 — therefore funnels through the same finally and flushes exactly once.
  - In the finally, `total` is removed from `openSpans` first so the loop ends only the auxiliary spans (defensive cleanup); `total` is then ended last so its `elapsedMs` brackets the entire request, including any cleanup of stragglers. `flushTrace` is wrapped in its own try/catch that logs a `trace_flush_failed` stderr line — mirroring the existing `appendQueryTrace` swallow-and-log pattern — so trace-write failures cannot change the response status.
  - `runtime_classify` and `resolve_db` both bracket the same `buildChatRuntime` call (concurrent spans wrapping the shared work) per the slice's explicit decision; the call is wrapped in a `try { ... } finally { endTrackedSpan(both); }` so an exception inside `buildChatRuntime` still ends both spans before propagating to the inner catch. A code comment at the call site documents the shared-call duplication.
  - All other LLM/DB stage spans (`template_match`, `sqlgen_llm`, `execute_db`, `repair_llm`, `synthesize_llm`, `sanity_check`) are similarly enclosed in `try { ... } finally { endTrackedSpan(...); }` so their elapsed times reflect just the wrapped call (and not subsequent error-handling work) even on the throw path.
  - `repair_llm`: the span is scoped strictly to the `repairSqlWithAnthropic` call via an inner `try { repaired = await repairSqlWithAnthropic(...) } finally { endTrackedSpan(repairSpan) }`. That inner block sits inside the original outer `try { ...repair LLM + repair_retry... } catch (repairError) { ...heuristic fallback... }`, which preserves the pre-slice fallback semantics: if either `repairSqlWithAnthropic` throws OR the subsequent `executeSqlWithTrace(..., "repair_retry")` throws, the same outer catch logs `chat_query_repair_failed` and runs `heuristic_after_sql_failure` (revision applied 2026-04-26 in response to the implementation-audit REVISE verdict above).
  - `flushTrace` receives `SpanRecord[]` (the values returned by `Span.end()`), not active `Span` objects, satisfying the slice's lifecycle correction.
  - Coexistence with the existing `appendQueryTrace` writes is preserved unchanged: the perfTrace records are uniquely identifiable by the top-level `spans` array; `appendQueryTrace` records continue to carry `status`, `queryPath`, `sql`, etc. Both writers append to `web/logs/chat_query_trace.jsonl`.
- Test approach:
  - `web/scripts/tests/route-trace.test.mjs` is a static-analysis test that reads `web/src/app/api/chat/route.ts` as text and asserts: (1) the file imports `startSpan` and `flushTrace` from `@/lib/perfTrace`, (2) each of the 10 stage names appears in at least one `startSpan("<stage>")` literal call site, (3) at least one `flushTrace(` call appears, (4) at least one `} finally {` block appears. No live Postgres or Anthropic dependency is required, matching the slice's "Required services / env: None" promise.
  - Filename follows the `web/scripts/tests/*.test.mjs` glob, so `npm run test:grading` (`node --test scripts/tests/*.test.mjs`) picks it up automatically.
- Gate command results (run from `web/`, in slice-specified order; re-run after the 2026-04-26 revision that restored repair fallback semantics):
  - `npm run build` — exit `0`. Next 15 compile + page generation succeeded; `/api/chat` builds dynamic.
  - `npm run typecheck` — exit `0`. `tsc --noEmit` clean.
  - `npm run test:grading` — exit `0`. TAP `1..15`; `# pass 6 # fail 0 # skipped 9`. The new `chat route imports perfTrace, opens a finally block, and starts a span for every stage` test is subtest 6 and passes; the prior `perfTrace records elapsed ms per span ...` test (subtest 5) still passes; the 9 chat-integration propagation tests skip as designed without `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`.
- Revision applied 2026-04-26 (addresses implementation-audit REVISE verdict in this file):
  - Restored the original outer `try { repairSqlWithAnthropic(...) + executeSqlWithTrace(..., "repair_retry") } catch (repairError) { log + heuristic_after_sql_failure }` structure in `route.ts` so a `repair_retry` execution failure once again triggers the `chat_query_repair_failed` log + heuristic fallback (regression diagnosed at the prior `route.ts:573`).
  - The `repair_llm` span remains scoped strictly to the `repairSqlWithAnthropic` call: inside the outer try, an inner `try { repaired = await repairSqlWithAnthropic(...) } finally { endTrackedSpan(repairSpan) }` ends the span before the retry runs (and before the catch fires on LLM failure).
  - All three gates re-run from `web/`, all exit 0; the static-analysis test still asserts the four required conditions and passes.
- Revision applied 2026-04-26 (round 2 — addresses audit verdict round 2 in this file):
  - `web/src/app/api/chat/route.ts`: `totalSpan` is no longer started before the outer try. The new structure is `let totalSpan: Span | null = null;` declared at function scope (before the outer try, so the finally can still close it), with `totalSpan = startTrackedSpan(startSpan("total"));` as the FIRST statement inside the outer try. The outer try now opens immediately after the trace-state declarations (which are pure `const` declarations of helpers/state and cannot throw — there are no early returns or exits between `requestId` and the try). The body-parse `try`/`catch`, the missing-message early return, and every other documented exit path remain inside the outer try, so `flushTrace` continues to fire exactly once on every exit.
  - The finally block now guards both `openSpans.delete(totalSpan)` and `traceRecords.push(totalSpan.end())` with `if (totalSpan)` so even on the (now-impossible) path where `totalSpan` assignment is interrupted, the finally still runs without dereferencing null and still flushes any other tracked spans.
  - No other code paths or behaviors changed; the repair-fallback restoration from the prior revision is preserved verbatim.
  - All three gates re-run from `web/`, all exit `0`; the static-analysis test (`route-trace.test.mjs`, subtest 6) continues to assert the four required conditions and passes (TAP `1..15`, `# pass 6 # fail 0 # skipped 9`).
  - Commit hash for this revision: `3da753b`.
- Self-checks against acceptance criteria:
  - [x] Imports of `startSpan` and `flushTrace` from `@/lib/perfTrace` resolve at typecheck time in `route.ts` — `npm run typecheck` exit 0.
  - [x] Each of the 10 stage names appears in at least one `startSpan("<stage>")` call site in `route.ts` — verified by the static-analysis test (subtest 6, exit 0). `runtime_classify` and `resolve_db` are both started immediately before `buildChatRuntime` and ended after it resolves, with a code comment noting the shared call.
  - [x] `route.ts` calls `flushTrace(requestId, traceRecords)` from a `finally` block whose `try` opens immediately after `requestId` is generated, so every exit path flushes exactly once.
  - [x] `flushTrace` is invoked with a `SpanRecord[]` (the values returned by `Span.end()`), not active `Span` objects — `traceRecords: SpanRecord[]` is built by `endTrackedSpan` and the finally cleanup; type-checked.
  - [x] The existing `appendQueryTrace` JSONL writes are unchanged in shape and file path; perfTrace records are distinguishable by the top-level `spans` array.
  - [x] `web/scripts/tests/route-trace.test.mjs` exists, is executed by `npm run test:grading`, and asserts the four conditions in step 6.
  - [x] All gates exit 0.

## Audit verdict
**Status: REVISE** — independent audit on 2026-04-26.

Gate commands re-run locally from `web/`:
- `npm run build` — exit `0`
- `npm run typecheck` — exit `0`
- `npm run test:grading` — exit `0`; TAP `1..15`, `# pass 6`, `# skipped 9`, including `ok 6 - chat route imports perfTrace, opens a finally block, and starts a span for every stage`.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned `diagnostic/slices/01-route-stage-timings.md`, `web/scripts/tests/route-trace.test.mjs`, and `web/src/app/api/chat/route.ts`.
- Scope check passes. The route and test are listed under "Changed files expected"; this slice file is implicitly allowed.

Acceptance criteria:
- PASS: `route.ts` imports `startSpan`, `flushTrace`, and perfTrace types; `npm run typecheck` resolves them.
- PASS: all 10 required `startSpan("<stage>")` call sites exist, and the static-analysis test covers them.
- PASS: `runtime_classify` and `resolve_db` are started together immediately before `buildChatRuntime` and ended together after it resolves; the code includes a comment documenting the shared call.
- PASS: `flushTrace(requestId, traceRecords)` is called from a `finally` block and receives `SpanRecord[]` values produced by `Span.end()`.
- PASS: the existing `appendQueryTrace` writes still append to `chat_query_trace.jsonl` with their existing payload fields; perfTrace records remain distinguishable by top-level `spans`.
- PASS: `web/scripts/tests/route-trace.test.mjs` exists, is picked up by `npm run test:grading`, and asserts the required static conditions.

Required revision:
- `web/src/app/api/chat/route.ts:539` changes the existing repair fallback behavior. Before this slice, the `try` around `repairSqlWithAnthropic` also covered `executeSqlWithTrace(generatedSql, generationSource, "repair_retry")`; if the repaired SQL execution failed, the `catch` logged `chat_query_repair_failed` and fell back to `heuristic_after_sql_failure`. In the new code, `repairSqlWithAnthropic` is caught into `repairError`, but `executeSqlWithTrace(..., "repair_retry")` at `web/src/app/api/chat/route.ts:573` runs outside that catch, so a repaired-SQL execution failure now escapes to the generic/transient outer catch instead of using the prior heuristic fallback. Preserve the original fallback semantics while keeping the `repair_llm` span scoped only to the `repairSqlWithAnthropic` call.

## Audit verdict (round 2)
**Status: REVISE** — independent audit on 2026-04-26.

Gate commands re-run locally from `web/`:
- `npm run build` — exit `0`
- `npm run typecheck` — exit `0`
- `npm run test:grading` — exit `0`; TAP `1..15`, `# pass 6`, `# skipped 9`, including `ok 6 - chat route imports perfTrace, opens a finally block, and starts a span for every stage`.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned `diagnostic/slices/01-route-stage-timings.md`, `web/scripts/tests/route-trace.test.mjs`, and `web/src/app/api/chat/route.ts`.
- Scope check passes. The route and test are listed under "Changed files expected"; this slice file is implicitly allowed.

Acceptance criteria:
- PASS: `route.ts` imports `startSpan`, `flushTrace`, and perfTrace types; `npm run typecheck` resolves them.
- PASS: all 10 required `startSpan("<stage>")` call sites exist, and the static-analysis test covers them.
- PASS: `runtime_classify` and `resolve_db` are started together immediately before `buildChatRuntime` and ended together after it resolves; the code includes a comment documenting the shared call.
- PASS: `flushTrace(requestId, traceRecords)` receives `SpanRecord[]` values produced by `Span.end()`, not active `Span` objects.
- PASS: the existing `appendQueryTrace` writes still append to `chat_query_trace.jsonl` with their existing payload fields; perfTrace records remain distinguishable by top-level `spans`.
- PASS: `web/scripts/tests/route-trace.test.mjs` exists, is picked up by `npm run test:grading`, and asserts the required static conditions.
- REVISE: `web/src/app/api/chat/route.ts:153` starts `totalSpan` before the outer `try`, and the outer `try` does not open immediately after `requestId` is generated. The slice explicitly requires the outer `try { ... } finally { ... }` to open immediately after `requestId` is generated, before body parsing and validation exits, with `startSpan("total")` as the first action inside that `try`. Move `totalSpan` initialization inside the outer `try` as its first action while preserving the finally cleanup and exactly-once `flushTrace` behavior.

## Audit verdict (round 3)
**Status: PASS** — independent audit on 2026-04-26.

Gate commands re-run locally from `web/`:
- `npm run build` — exit `0`; Next production build completed successfully.
- `npm run typecheck` — exit `0`; `tsc --noEmit` clean.
- `npm run test:grading` — exit `0`; TAP `1..15`, `# pass 6`, `# fail 0`, `# skipped 9`, including `ok 6 - chat route imports perfTrace, opens a finally block, and starts a span for every stage`.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned `diagnostic/slices/01-route-stage-timings.md`, `web/scripts/tests/route-trace.test.mjs`, and `web/src/app/api/chat/route.ts`.
- Scope check passes. The route and test are listed under "Changed files expected"; this slice file is implicitly allowed.

Acceptance criteria:
- PASS: `route.ts` imports `startSpan`, `flushTrace`, and perfTrace types from `@/lib/perfTrace`; `npm run typecheck` resolves them.
- PASS: all 10 required `startSpan("<stage>")` call sites exist, and the static-analysis test covers them.
- PASS: `runtime_classify` and `resolve_db` are started together immediately before `buildChatRuntime` and ended together after it resolves; the code includes a comment documenting the shared call.
- PASS: `flushTrace(requestId, traceRecords)` is called from the outer `finally` block after defensively ending open spans and ending `total`; `traceRecords` is typed as `SpanRecord[]` and populated from `Span.end()` values, not active `Span` objects.
- PASS: invalid JSON, missing message, clarification-required, completeness-blocked, success, transient DB unavailable, and generic error exits are inside the outer `try`/`finally` and flush exactly once.
- PASS: the existing `appendQueryTrace` writer still appends to `chat_query_trace.jsonl` with its existing payload fields; perfTrace records are distinguishable by a top-level `spans` array.
- PASS: `web/scripts/tests/route-trace.test.mjs` exists, is picked up by `npm run test:grading`, and asserts the four required static conditions.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Specify that the route trace test must live under `web/scripts/tests/*.test.mjs` or change the gate commands so the listed test is actually executed by `npm run test:grading`.
- [x] Define how the route test avoids live Postgres and Anthropic dependencies, or update `Required services / env` with the exact services and environment variables the gate requires.
- [x] Clarify conditional stage semantics so the acceptance criteria are achievable: either every trace record must include all ten stage names including skipped/no-op stages, or the tests must cover branch-specific stage sets instead of expecting one request to hit every conditional stage.
- [x] Require trace flushing on all route exits covered by the goal, including early returns and error paths, or narrow the goal and acceptance criteria to the specific successful path being instrumented.

### Medium
- [x] Update step 3 to say `flushTrace` receives `SpanRecord[]` produced by `Span.end()`, not active `Span` objects.
- [x] Specify how the new perf-trace record coexists with the route's existing `appendQueryTrace` writes to `web/logs/chat_query_trace.jsonl`, including how tests identify the structured stage-timing record.

### Low
- [x] Replace `web/src/lib/__tests__/routeTrace.test.ts (or equivalent)` with the exact intended test path once the test-runner issue is resolved.

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Resolve the contradiction between the combined `runtime_classify` / `resolve_db` exception and the static-analysis test: either require both `startSpan("runtime_classify")` and `startSpan("resolve_db")` call sites, or update step 6 so the test accepts the documented one-stage combined-span exception.
- [x] Include the invalid-JSON and missing-message early returns in the explicit `try` / `finally` coverage, or narrow the goal so "every request" does not include those validation exits.

### Medium
- [x] Align the acceptance criterion for "each of the 10 stage names" with the resolved combined-span rule so it no longer says both all 10 names are required and one of the two names may be omitted.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Define a coherent lifecycle for the shared `buildChatRuntime` instrumentation: either start both `runtime_classify` and `resolve_db` before the call and end both after it resolves, or explicitly make one stage a synthetic/no-op span, instead of instructing `runtime_classify` to end before `resolve_db` starts while both are said to bracket the same call.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.
