---
slice_id: 02-cache-hit-assertion
phase: 2
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Run a real synthesis pair (cold + warm) against Anthropic and verify the warm call records `cache_read_input_tokens > 0` in the SDK response. Capture before/after p50 token-cost rows.

## Inputs
- `web/src/lib/chatRuntime.ts` (after `02-cache-control-markers`)
- `web/scripts/tests/grading.test.mjs`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/02-cache-control-markers.md`

## Required services / env
`ANTHROPIC_API_KEY` for live SDK call.

## Steps
1. Add a benchmark test (gated on `OPENF1_RUN_CACHE_BENCHMARK=1`) that issues two identical-prefix questions back-to-back.
2. Read `usage.cache_read_input_tokens` from the second response; assert > 0.
3. Capture both responses' total cost rows in the cost ledger so the saving is visible.
4. Write summary to `diagnostic/artifacts/perf/02-cache-hit_<date>.json`.

## Changed files expected
- `web/scripts/tests/cache-benchmark.test.mjs`
- `diagnostic/artifacts/perf/02-cache-hit_2026-04-26.json`

## Artifact paths
- `diagnostic/artifacts/perf/02-cache-hit_2026-04-26.json`

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Warm call's `cache_read_input_tokens` > 0.
- [ ] Artifact JSON shows cold vs warm token cost.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
