---
slice_id: 00-verify-script
phase: 0
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25T22:02:26-04:00
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
Branch: slice/00-verify-script

Added `"verify": "npm run typecheck && npm run test:grading && npm run build"` to `web/package.json` scripts block.

Gate: `cd web && npm run verify` — exit 0
- typecheck: clean (tsc --noEmit, no errors)
- test:grading: 4 pass, 0 fail, 9 skipped (integration tests require OPENF1_RUN_CHAT_INTEGRATION_TESTS=1)
- build: Next.js 15.5.15 compiled successfully, 20 routes generated

Self-check: `verify` key present in `web/package.json`; script chains the three required commands.

## Audit verdict
(filled by auditor)
