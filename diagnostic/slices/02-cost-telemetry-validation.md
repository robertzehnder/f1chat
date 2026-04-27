---
slice_id: 02-cost-telemetry-validation
phase: 2
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
