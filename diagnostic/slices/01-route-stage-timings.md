---
slice_id: 01-route-stage-timings
phase: 1
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T13:15:49Z
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
   - `runtime_classify` — wrap the question-type classification step. Since `buildChatRuntime` performs both classification and DB resolution internally, model this as a span that begins immediately before the `buildChatRuntime` call and ends synthetically once that call returns the classification fields (`runtime.questionType` / equivalent). It is acceptable for `runtime_classify` and `resolve_db` to be back-to-back spans that bracket the same `buildChatRuntime` call (start `runtime_classify` → end it → start `resolve_db` → end it after the call resolves), so each stage name still appears in source even though the underlying work is shared. A one-line code comment must note that both spans wrap a shared call.
   - `resolve_db` — see above; ends after `buildChatRuntime` resolves.
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
- [ ] Each of the 10 stage names from step 2 appears in at least one `startSpan("<stage>")` call site in `route.ts` (verified by the static-analysis test). All 10 are required — no combined-span exception. `runtime_classify` and `resolve_db` are emitted as back-to-back spans bracketing the shared `buildChatRuntime` call, with a one-line code comment noting the shared call.
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
- [ ] Define a coherent lifecycle for the shared `buildChatRuntime` instrumentation: either start both `runtime_classify` and `resolve_db` before the call and end both after it resolves, or explicitly make one stage a synthetic/no-op span, instead of instructing `runtime_classify` to end before `resolve_db` starts while both are said to bracket the same call.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.
