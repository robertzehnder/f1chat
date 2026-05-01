---
slice_id: 12-env-assertions
phase: 12
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-05-01
---

## Goal
Add startup assertions for all production-required env vars (DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENF1_*) with clear error messages.

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
- `web/src/lib/env.ts`
- `web/src/app/layout.tsx`

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
- [ ] Align the goal, steps, changed-file scope, and acceptance criteria with Phase 12's approved env-hardening scope: cover the existing Neon/local database-env behavior (`NEON_DATABASE_URL` and local Docker expectations), not only `DATABASE_URL`/LLM keys/`OPENF1_*`.
- [ ] Replace the staging/deployment-only step and acceptance criterion with repo-local, auditable deliverables, or specify the exact non-prod environment, required credentials, operator, and success command/output so the implementer is not blocked on unspecified deployment access.

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required baseline-aware grading gate.
- [ ] Fix `Changed files expected` to match the modules this plan actually has to touch: `web/src/lib/env.ts` does not exist here, while the current database-env assertions live in `web/src/lib/db.ts`; include any required docs file such as `.env.example` if the slice keeps the Phase 12 env-documentation work in scope.
- [ ] Make the acceptance criteria testable from declared artifacts and gate commands; `Implementation works in staging` and `Rollback plan documented in slice-completion note` are not verifiable by the listed gates.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T20:49:40Z`).
