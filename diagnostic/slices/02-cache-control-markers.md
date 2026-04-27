---
slice_id: 02-cache-control-markers
phase: 2
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T04:26:38Z
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Correct the target file and steps to apply cache-control markers at the synthesis Anthropic request assembly in `web/src/lib/anthropic.ts`, because prior slice `02-prompt-static-prefix-split` explicitly left `web/src/lib/chatRuntime.ts` read-only and confirmed it does not assemble the synthesis prompt.
- [ ] Specify the exact Anthropic request shape that carries `cache_control` for the static prefix, including whether the existing string `system` field must become a content-block array or another SDK-supported structure.

### Medium
- [ ] Update `Changed files expected` to include every file the revised steps touch, including `web/src/lib/anthropic.ts`, and exclude `web/src/lib/chatRuntime.ts` unless the revised plan identifies a concrete runtime change there.
- [ ] Make the beta-header requirement testable by naming the exact header/configuration to add for the repo's installed Anthropic SDK version, or explicitly state that no beta header is required and why.
- [ ] Update the unit-test step wording so it asserts cache-control on the static prefix request payload rather than a "prefix message", since the prior split exposes `staticPrefix` as the synthesis `system` content and the dynamic suffix as `messages[0].content`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.
