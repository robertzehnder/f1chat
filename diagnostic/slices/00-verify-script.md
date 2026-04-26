---
slice_id: 00-verify-script
phase: 0
status: pending
owner: claude
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Add `npm run verify` that chains typecheck + tests + build into a single pre-PR command.

## Inputs
- `web/package.json`

## Required services / env
None.

## Steps
1. In `web/package.json`, add a `verify` script:
   ```json
   "verify": "npm run typecheck && npm run test:grading && npm run build"
   ```
2. Confirm `npm run verify` exits 0.

## Changed files expected
- `web/package.json`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run verify
```

## Acceptance criteria
- [ ] Script exists in `package.json`.
- [ ] `npm run verify` exits 0.

## Out of scope
- Adding new gates inside the script (security audit, SQL parse) — those run conditionally on relevant slices, not on every dev verify.

## Risk / rollback
Rollback: remove the line from `package.json`.

## Slice-completion note
(filled by Claude)

## Audit verdict
PASS — plan is self-consistent and the gate matches the stated acceptance criteria.
