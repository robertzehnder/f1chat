---
slice_id: 02-cache-control-markers
phase: 2
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Add Anthropic `cache_control: {type: 'ephemeral'}` markers to the static prefix block so subsequent identical-prefix calls hit the prompt cache.

## Inputs
- `web/src/lib/chatRuntime.ts` (after `02-prompt-static-prefix-split`)
- Anthropic SDK docs on prompt caching headers

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/02-prompt-static-prefix-split.md`

## Required services / env
None at author time.

## Steps
1. Wrap the staticPrefix payload with the SDK's cache_control marker.
2. If the SDK requires a beta header (`anthropic-beta: prompt-caching-2024-07-31` or current equivalent), add it to the request.
3. Update the synthesis-prompt unit test to assert the cache_control field is present on the prefix message but absent on the suffix.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/scripts/tests/prompt-prefix-split.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Synthesis call includes cache_control markers on staticPrefix.
- [ ] Suffix has no cache_control marker.
- [ ] Tests pass.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
