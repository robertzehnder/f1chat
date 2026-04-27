---
slice_id: 12-env-assertions
phase: 12
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-26
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
