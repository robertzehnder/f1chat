---
slice_id: 01-route-stage-timings
phase: 1
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T13:07:02Z
---

## Goal
Wire the per-stage perf-trace helpers (built in `01-perf-trace-helpers`) into the chat route so every request emits a structured stage-timing record.

## Inputs
- `web/src/lib/perfTrace.ts` — span helpers from prior slice
- `web/src/app/api/chat/route.ts` — chat endpoint
- [roadmap §4 Phase 1](../roadmap_2026-04_performance_and_upgrade.md)

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, recent merges, accumulated auditor notes.
- `diagnostic/slices/01-perf-trace-helpers.md` — defines the `startSpan` / `Span.end` / `flushTrace` API this slice integrates with. The acceptance criteria here must match what that slice actually exported.
- The chat route at `web/src/app/api/chat/route.ts` to confirm the actual stage boundaries before writing the integration test.

## Required services / env
None at author time. The chat route does run a Postgres query at request time, but the spans wrap whatever the request does — not the slice's gates.

## Steps
1. Import `startSpan` / `flushTrace` (or equivalent helpers) from `web/src/lib/perfTrace.ts` into `web/src/app/api/chat/route.ts`.
2. Wrap each pipeline stage in a span with these stage names: `request_intake`, `runtime_classify`, `resolve_db`, `template_match`, `sqlgen_llm`, `execute_db`, `repair_llm`, `synthesize_llm`, `sanity_check`, `total`.
3. At end of request, `flushTrace(requestId, spans)` writes one structured JSON line to `web/logs/chat_query_trace.jsonl`.
4. Add a unit/integration test that hits the route once and asserts a trace line was appended with all expected stage names.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/__tests__/routeTrace.test.ts` (or equivalent)
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
- [ ] Imports from `perfTrace.ts` resolve at typecheck time.
- [ ] Every named stage from step 2 appears in at least one trace record produced by a test request.
- [ ] All gates exit 0.

## Out of scope
- The /api/admin/perf-summary route (separate slice `01-perf-summary-route`).
- Capturing baseline traces (`01-baseline-snapshot`).

## Risk / rollback
Rollback: `git revert <commit>`. The trace file is dev-sink only; no persistent state is at risk.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Specify that the route trace test must live under `web/scripts/tests/*.test.mjs` or change the gate commands so the listed test is actually executed by `npm run test:grading`.
- [ ] Define how the route test avoids live Postgres and Anthropic dependencies, or update `Required services / env` with the exact services and environment variables the gate requires.
- [ ] Clarify conditional stage semantics so the acceptance criteria are achievable: either every trace record must include all ten stage names including skipped/no-op stages, or the tests must cover branch-specific stage sets instead of expecting one request to hit every conditional stage.
- [ ] Require trace flushing on all route exits covered by the goal, including early returns and error paths, or narrow the goal and acceptance criteria to the specific successful path being instrumented.

### Medium
- [ ] Update step 3 to say `flushTrace` receives `SpanRecord[]` produced by `Span.end()`, not active `Span` objects.
- [ ] Specify how the new perf-trace record coexists with the route's existing `appendQueryTrace` writes to `web/logs/chat_query_trace.jsonl`, including how tests identify the structured stage-timing record.

### Low
- [ ] Replace `web/src/lib/__tests__/routeTrace.test.ts (or equivalent)` with the exact intended test path once the test-runner issue is resolved.

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T04:32:14Z`, which is less than 24 hours old at audit time.
