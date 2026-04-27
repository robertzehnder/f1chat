---
slice_id: 02-cache-hit-assertion
phase: 2
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T04:38:10Z
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the "SDK response" assumption with an executable direct-`fetch` strategy or an explicit code change that exposes `payload.usage`, because this repo has no Anthropic SDK dependency and `synthesizeAnswerWithAnthropic` currently discards the raw response usage fields.
- [ ] Add a gate command that actually runs the live benchmark with `OPENF1_RUN_CACHE_BENCHMARK=1` and `ANTHROPIC_API_KEY` present, because the listed `npm run test:grading` command will skip the gated cache assertion by default.

### Medium
- [ ] Update `Inputs` to remove the nonexistent `web/scripts/tests/grading.test.mjs` path and include the concrete source file the benchmark will import or modify.
- [ ] Define the cache-hit benchmark artifact naming with a captured UTC `DATE` token instead of the stale hard-coded `2026-04-26` path, and align `Changed files expected` / `Artifact paths` to that convention.
- [ ] Specify the exact benchmark payload construction and response fields to record, including model id, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and the before/after token-cost rows needed by the goal.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.
