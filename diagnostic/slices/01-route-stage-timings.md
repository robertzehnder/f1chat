---
slice_id: 01-route-stage-timings
phase: 1
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Wire the per-stage perf-trace helpers (built in `01-perf-trace-helpers`) into the chat route so every request emits a structured stage-timing record.

## Inputs
- `web/src/lib/perfTrace.ts` — span helpers from prior slice
- `web/src/app/api/chat/route.ts` — chat endpoint
- [roadmap §4 Phase 1](../roadmap_2026-04_performance_and_upgrade.md)

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
