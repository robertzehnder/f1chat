---
slice_id: 12-migration-runner-adoption
phase: 12
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-05-01
---

## Goal
Adopt a SQL migration runner (sqitch / Atlas / custom python) for all schema changes going forward. Migrate existing matview SQL into the runner's format.

## Inputs
- Production deployment context
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12

## Prior context
- `diagnostic/_state.md`

## Required services / env
Production `DATABASE_URL`, deployment platform credentials.

## Steps
1. Design + implement the change.
2. Stage in a non-prod environment first.
3. Document the rollback procedure.
4. Land behind explicit user approval.

## Changed files expected
- `sql/migrations/`
- `scripts/migrate.sh`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Implementation works in staging.
- [ ] Rollback plan documented in slice-completion note.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching, requires user-approved sentinel before merge. Full rollback documented in slice.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the web-only gate block with migration-runner gates that exercise the declared scope end-to-end in a non-prod database, including applying the migrations, verifying the migrated matview objects exist/refresh correctly, and proving the rollback procedure works.
- [ ] Replace `Production DATABASE_URL` in Required services / env with the exact non-prod/staging database and deployment prerequisites needed for Step 2, and state the production approval/deploy inputs separately so the implementer does not run first-pass validation against production.

### Medium
- [ ] Commit to one migration-runner path in the plan and expand Changed files expected to cover the runner-specific config, invocation, and documentation files the implementation will necessarily touch; `sqitch / Atlas / custom python` is too open-ended to audit.
- [ ] Rewrite the acceptance criteria as command- or artifact-based checks owned by this slice instead of `Implementation works in staging` and a slice-completion note; they must be testable without subjective judgment.
- [ ] If a grading gate remains, invoke it via `bash scripts/loop/test_grading_gate.sh` rather than raw `cd web && npm run test:grading`, per loop policy.

### Low
- [ ] Clarify where the rollback procedure must live during implementation; `slice-completion note` conflicts with the production-facing nature of the change and does not identify a durable repo artifact.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-05-01T22:56:29Z, so no stale-state note is required.
