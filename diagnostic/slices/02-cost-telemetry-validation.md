---
slice_id: 02-cost-telemetry-validation
phase: 2
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T05:13:14Z
---

## Goal
Validate the post_dispatch_cost.sh estimator against actual billing console totals. After ~10 slices have run with cost telemetry, compare ledger sum vs Anthropic+OpenAI billing dashboard for the same period; if within 5%, flip `estimated:true` → `estimated:false` on backfilled rows.

## Inputs
- `scripts/loop/state/cost_ledger.jsonl`
- Anthropic billing console export
- OpenAI billing console export

## Prior context
- `diagnostic/_state.md`
- `scripts/loop/post_dispatch_cost.sh`

## Required services / env
Anthropic + OpenAI billing console access.

## Steps
1. Sum `cost_usd` from the ledger for the validation window.
2. Pull billing-console totals for the same window.
3. Compute delta % and write a validation note.
4. If within 5%: set `estimated:false` on rows in window via a one-time script; document.
5. If outside 5%: identify the parser gap and fix in `post_dispatch_cost.sh`.

## Changed files expected
- `scripts/loop/state/cost_ledger.jsonl`
- `diagnostic/notes/02-cost-telemetry-validation.md`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Ledger sum within 5% of billing-console totals OR parser gap documented and fixed.
- [ ] Validation note committed with the comparison numbers.

## Out of scope
- Backfilling cost rows for runs prior to Item 9 landing — those rows stay 0 with `estimated:true`.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Rewrite the gate command block so it is paste-safe from repo root; as written, consecutive `cd web && ...` lines will leave the shell in `web/` after the first command and make the next `cd web` fail.
- [ ] Specify concrete Anthropic and OpenAI billing export paths and the exact validation-window selection rule so the implementer can reproduce "same window" without guessing.

### Medium
- [ ] Add every conditionally touched implementation file to Changed files expected, including `scripts/loop/post_dispatch_cost.sh` when the delta is outside 5% and any committed one-time script if Step 4 requires one.
- [ ] Add a testable verification step for the ledger mutation or parser-gap path, such as a command/check that proves only rows in the validation window were flipped or that the parser fix changes the computed comparison.

### Low
- [ ] Clarify whether `diagnostic/notes/02-cost-telemetry-validation.md` is the validation artifact despite `## Artifact paths` saying `None`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state concern was found.
