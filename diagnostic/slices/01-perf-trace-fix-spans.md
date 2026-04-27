---
slice_id: 01-perf-trace-fix-spans
phase: 1
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Fix the span-boundary bug where `runtime_classify` and `resolve_db` report identical p50/p95 latencies (~7190ms each) in `01-baseline-snapshot_2026-04-26.json`. Local-only logic cannot take 7s; either spans share a parent that bleeds time, span ends are double-counted, or stage names are aliased. Once fixed, re-capture the baseline so Phase 2/3 measurements have a trustworthy "before" number.

## Inputs
- `web/src/lib/perfTrace.ts` (span helpers; idempotent `Span.end()`).
- `web/src/app/api/chat/route.ts` (where spans wrap stages).
- `web/src/lib/chatRuntime.ts` (where `runtime_classify` work actually executes).
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` (the misleading baseline).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/01-baseline-snapshot.md`
- `diagnostic/slices/01-route-stage-timings.md`

## Required services / env
- `DATABASE_URL` (read-replica via Neon pooler) — needed for the re-baseline run.
- `OPENF1_RUN_BENCHMARKS=1` if benchmark scripts gate on it.

## Steps
1. Read `web/src/app/api/chat/route.ts`. Identify every `startSpan(...)` / `Span.end()` call site. Confirm spans nest correctly (no overlapping `runtime_classify` and `resolve_db`).
2. Read `web/src/lib/chatRuntime.ts:516` area (where `runtime_classify` decisions live). Confirm the span around classification ends BEFORE `resolve_db` begins, not after the resolve work runs.
3. If the bug is double-counting (e.g. an outer span around both stages), tighten the boundaries so each stage's span captures only its own work.
4. Add a unit / integration test under `web/scripts/tests/perf-trace-spans.test.mjs` that asserts: when both `runtime_classify` and `resolve_db` spans run sequentially, their `elapsedMs` sums approximately match the wall-clock total (within 5%) and neither exceeds the realistic ceiling for that stage (`runtime_classify` < 50ms, `resolve_db` reflects actual DB time).
5. Re-run `01-baseline-snapshot` (manual: `npm run benchmark:trace` or whatever the project script is) to produce a fresh `01-baseline-snapshot-v2_<date>.json` artifact. Verify the two stages no longer report identical p50/p95.
6. Update `diagnostic/_state.md`'s "Latest perf baseline" headline to reference the v2 artifact.

## Changed files expected
- `web/src/app/api/chat/route.ts` (span boundary fix)
- `web/src/lib/chatRuntime.ts` (if the span lives inside the classifier)
- `web/scripts/tests/perf-trace-spans.test.mjs` (new test)
- `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json` (new artifact)

## Artifact paths
- `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json`

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] In the new perf-trace test, `runtime_classify` p50 < 50ms (it's local logic).
- [ ] In the new perf-trace test, `runtime_classify` and `resolve_db` p50 differ by ≥10× (i.e. they no longer alias).
- [ ] Re-captured baseline artifact shows the same separation (real benchmark run, not synthetic).
- [ ] All gate commands exit 0.
- [ ] `_state.md` "Latest perf baseline" points at the v2 artifact.

## Out of scope
- Changing what `runtime_classify` actually does (just fixing the timing boundary).
- Phase 2 prompt-caching work.

## Risk / rollback
Rollback: `git revert <commit>`. The original baseline artifact is preserved; v2 is additive.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
