---
slice_id: 02-prompt-static-prefix-split
phase: 2
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Split the chat synthesis prompt into a stable prefix block (system + few-shot + schema) and a dynamic suffix block (user question + retrieved facts). The prefix becomes the cache target; suffix changes per request.

## Inputs
- `web/src/lib/chatRuntime.ts` (synthesis prompt assembly)
- `web/src/lib/synthesisPrompts/` (static prompt assets, if any)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 2

## Required services / env
None at author time.

## Steps
1. Identify all input strings concatenated into the final synthesis prompt.
2. Refactor into two arrays: `staticPrefix` (system, few-shot examples, JSON schema) and `dynamicSuffix` (user message + retrieved fact contracts).
3. Add a unit test asserting `staticPrefix` is byte-identical for two different user questions.
4. Do NOT add cache_control markers yet — that's `02-cache-control-markers`.

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
- [ ] `staticPrefix` is byte-identical across two different user questions.
- [ ] Test exits 0 in `npm run test:grading`.

## Out of scope
- cache_control markers (next slice).
- Anthropic SDK changes.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
