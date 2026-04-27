---
slice_id: 05-template-cache-coverage-audit
phase: 5
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Audit which question templates short-circuit to cached deterministic responses today and document the coverage gap (which templates miss). Output a list to drive subsequent template-cache slices.

## Inputs
- `web/src/lib/templates/`
- `web/src/lib/chatRuntime.ts`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Walk the templates directory; for each template, identify whether the synthesis path can short-circuit to cache.
2. Write `diagnostic/notes/05-template-cache-coverage.md` with a table: template, cache-eligible (Y/N), reason if N.

## Changed files expected
- `diagnostic/notes/05-template-cache-coverage.md`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Doc lists ≥80% of templates with eligibility decisions.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
