---
slice_id: 06-cu-rightsize
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Right-size Neon compute unit allocation based on observed peak concurrent connections + query latency. Document the chosen value and the cost/perf tradeoff.

## Inputs
- `web/src/lib/db/driver.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6

## Prior context
- `diagnostic/_state.md`

## Required services / env
Production `DATABASE_URL` (Neon pooler). For Neon-config slices, requires Neon API token or console access.

## Steps
1. Read the current implementation if any.
2. Apply the change per the slice goal.
3. Add tests / docs as appropriate.
4. Verify against a real Neon connection.

## Changed files expected
- `diagnostic/notes/06-cu-rightsize.md`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Change is implemented and tested per the goal.
- [ ] Production-side behavior verified in the staging environment before merge.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching. Require user-approved sentinel before merge. Rollback: `git revert` + Neon-config revert if applicable.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the web-only gate commands with Neon-config validation gates that prove the chosen compute-unit value was applied and verified against a real Neon environment, because `build`/`typecheck`/`test:grading` can all pass without touching the compute allocation.

### Medium
- [ ] Specify the concrete implementation surface for the compute-unit change and include it in `Changed files expected`, because the current plan only expects `diagnostic/notes/06-cu-rightsize.md` even though the goal requires an actual Neon allocation decision plus recorded cost/perf tradeoff.
- [ ] Rewrite the acceptance criteria as measurable checks and remove the environment contradiction in “Production-side behavior verified in the staging environment before merge.”

### Low
- [ ] Tighten the step list so it names the evidence to inspect and the artifact to produce, instead of generic placeholders like “Apply the change per the slice goal” and “Add tests / docs as appropriate.”

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no staleness note applies.
