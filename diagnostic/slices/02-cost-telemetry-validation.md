---
slice_id: 02-cost-telemetry-validation
phase: 2
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T05:17:44Z
---

## Goal
Validate the post_dispatch_cost.sh estimator against actual billing console totals. After ~10 slices have run with cost telemetry, compare ledger sum vs Anthropic+OpenAI billing dashboard for the same period; if within 5%, flip `estimated:true` → `estimated:false` on backfilled rows.

## Inputs
- `scripts/loop/state/cost_ledger.jsonl` (gitignored runtime ledger; lives outside the branch)
- Anthropic billing console CSV export saved to `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`
- OpenAI billing console CSV export saved to `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`

## Prior context
- `diagnostic/_state.md`
- `scripts/loop/post_dispatch_cost.sh`
- `scripts/loop/pricing.json`

## Required services / env
- Anthropic billing console access (https://console.anthropic.com/settings/usage) — CSV export for the validation window.
- OpenAI billing console access (https://platform.openai.com/usage) — CSV export for the validation window.
- `LOOP_STATE_DIR` exported (same value the runner uses) so the implementer reads the same `cost_ledger.jsonl` the loop wrote to.

## Validation window selection rule
- **Window-start (UTC):** the `ts` of the first ledger row whose `slice` is one of the ten most recent merges in `diagnostic/_state.md` "Recent slice merges" table at the time the slice begins.
- **Window-end (UTC):** the `ts` of the most recent ledger row at the time the slice begins (i.e. `tail -1 cost_ledger.jsonl | jq -r .ts`).
- Record both timestamps verbatim (ISO-8601, second precision) at the top of the validation note. Both billing-console exports MUST be requested for the same `[window-start, window-end]` range; if a console only supports day-granularity, round window-start down and window-end up to whole UTC days and document the rounding in the note.

## Steps
1. Compute the validation window per the rule above. Record `window-start`, `window-end`, and the slice IDs the window covers in the validation note.
2. Sum `cost_usd` from the ledger for rows whose `ts` is within `[window-start, window-end]`. Break the sum down by `agent` (claude vs codex) so it can be compared to per-vendor billing totals.
3. Export the Anthropic billing CSV for the window into `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`. Sum the `cost` column.
4. Export the OpenAI billing CSV for the window into `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`. Sum the `cost` column.
5. Compute `delta_pct = (ledger_sum - billing_sum) / billing_sum * 100` per vendor and overall. Write `diagnostic/notes/02-cost-telemetry-validation.md` containing: window timestamps, per-vendor ledger sums, per-vendor billing sums, deltas, and pass/fail against the 5% threshold.
6. If overall delta within ±5%: write a one-time script `scripts/loop/one_time/02_flip_estimated_false.sh` that rewrites `cost_ledger.jsonl` in place, setting `"estimated":false` ONLY on rows whose `ts` is within the window. The script MUST: (a) take `--window-start` and `--window-end` flags, (b) write to a temp file then `mv` atomically, (c) emit a count of rows flipped to stdout. Run it; commit the script (the ledger itself is gitignored — record before/after counts in the note).
7. If overall delta outside ±5%: identify the parser gap (most likely log-file discovery cutoff, missing usage path in the python parser, or pricing rate mismatch in `scripts/loop/pricing.json`). Patch `scripts/loop/post_dispatch_cost.sh` and/or `scripts/loop/pricing.json`. Document the root cause and the fix in the note. Do NOT flip `estimated:false` until a follow-up slice re-validates.

## Changed files expected
- `diagnostic/notes/02-cost-telemetry-validation.md` (always)
- `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv` (always)
- `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv` (always)
- `scripts/loop/one_time/02_flip_estimated_false.sh` (only on within-5% path)
- `scripts/loop/post_dispatch_cost.sh` (only on outside-5% path, when parser gap is in the parser)
- `scripts/loop/pricing.json` (only on outside-5% path, when parser gap is a stale rate)

> Note: `scripts/loop/state/cost_ledger.jsonl` is gitignored and not committed; mutation of it is recorded in the note via row counts, not by checking it in.

## Artifact paths
- `diagnostic/notes/02-cost-telemetry-validation.md` — validation note (comparison numbers, deltas, decision).
- `diagnostic/artifacts/cost/anthropic_<window-start>_<window-end>.csv`
- `diagnostic/artifacts/cost/openai_<window-start>_<window-end>.csv`

## Gate commands
```bash
# Run from repo root. Each line uses `npm --prefix web` so cwd is unchanged.
npm --prefix web run typecheck
npm --prefix web run test:grading
npm --prefix web run build

# Validation-specific gates (run from repo root):
test -f diagnostic/notes/02-cost-telemetry-validation.md
ls diagnostic/artifacts/cost/anthropic_*.csv diagnostic/artifacts/cost/openai_*.csv

# Within-5% path only — verify the flip script touched only window rows:
# (Skip if outside-5% path was taken; the note will say so.)
bash scripts/loop/one_time/02_flip_estimated_false.sh --window-start "$WINDOW_START" --window-end "$WINDOW_END" --dry-run \
  | grep -E '^rows_in_window=[0-9]+ rows_outside_window_unchanged=[0-9]+$'

# Outside-5% path only — re-run the estimator on a synthetic session log and confirm the
# computed cost matches the patched expectation documented in the note:
# (Skip if within-5% path was taken.)
bash scripts/loop/post_dispatch_cost.sh --self-test 2>&1 | tee /tmp/02-cost-selftest.log
grep -E 'self-test (PASS|OK)' /tmp/02-cost-selftest.log
```

## Acceptance criteria
- [ ] Validation note `diagnostic/notes/02-cost-telemetry-validation.md` committed with: window-start, window-end, per-vendor ledger sums, per-vendor billing sums, deltas, decision.
- [ ] Both billing-console CSVs committed under `diagnostic/artifacts/cost/`.
- [ ] **Within-5% path:** `scripts/loop/one_time/02_flip_estimated_false.sh` committed; running it with `--dry-run` reports `rows_in_window` > 0 and `rows_outside_window_unchanged` equal to the count of out-of-window ledger rows; note records before/after `estimated:true` counts.
- [ ] **Outside-5% path:** parser-gap root cause documented in note; fix landed in `scripts/loop/post_dispatch_cost.sh` and/or `scripts/loop/pricing.json`; estimator self-test (or equivalent before/after computed-cost comparison in the note) demonstrates the fix changes the result in the expected direction.

## Out of scope
- Backfilling cost rows for runs prior to Item 9 landing — those rows stay 0 with `estimated:true`.
- Re-validating after an outside-5% fix — that is a follow-up slice.

## Risk / rollback
Rollback: `git revert <commit>`. The flip script edits a gitignored file; if it mis-flips rows, restore `cost_ledger.jsonl` from the most recent runner backup or hand-edit (acceptable because the ledger is append-only telemetry, not load-bearing data).

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the gate command block so it is paste-safe from repo root; as written, consecutive `cd web && ...` lines will leave the shell in `web/` after the first command and make the next `cd web` fail.
- [x] Specify concrete Anthropic and OpenAI billing export paths and the exact validation-window selection rule so the implementer can reproduce "same window" without guessing.

### Medium
- [x] Add every conditionally touched implementation file to Changed files expected, including `scripts/loop/post_dispatch_cost.sh` when the delta is outside 5% and any committed one-time script if Step 4 requires one.
- [x] Add a testable verification step for the ledger mutation or parser-gap path, such as a command/check that proves only rows in the validation window were flipped or that the parser fix changes the computed comparison.

### Low
- [x] Clarify whether `diagnostic/notes/02-cost-telemetry-validation.md` is the validation artifact despite `## Artifact paths` saying `None`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Reorder the web gate commands so `npm --prefix web run build` runs before `npm --prefix web run typecheck`, because `web/next-env.d.ts` references `.next/types/routes.d.ts` generated by the build.
- [ ] Make the within-5% flip-script requirements match the gate by explicitly requiring `--dry-run` support and the exact `rows_in_window=... rows_outside_window_unchanged=...` stdout format used by the gate.
- [ ] Fix the outside-5% gate so it is satisfiable for both parser fixes and pricing-only fixes; either require implementing `scripts/loop/post_dispatch_cost.sh --self-test` on every outside-5% path or replace the gate with the accepted before/after computed-cost comparison artifact.

### Medium
- [ ] Define the ledger-to-vendor grouping rule for all expected agent values, including `claude-revise`, `claude-repair`, `codex-native`, and `codex-claude-fallback`, so per-vendor deltas cannot be computed inconsistently.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.
