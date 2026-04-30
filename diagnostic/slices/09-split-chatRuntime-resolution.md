---
slice_id: 09-split-chatRuntime-resolution
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract entity-resolution wiring from chatRuntime.ts into chatRuntime/resolution.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/resolution.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target entity-resolution symbols in `web/src/lib/chatRuntime.ts` (e.g. `ResolutionStatus`, `requiresResolvedSession`, `sessionRecencyValue`, `compareSessionScored`, `buildSessionLabel`, `mergeSessionRows`, `mergeDriverRows`, `deriveResolutionStatus`, `scoreDriverCandidate`, plus their helper-only internals). Lock the final list before moving.
2. Move them verbatim to `web/src/lib/chatRuntime/resolution.ts` (a new module). Add `export *` (or named) re-exports back through `web/src/lib/chatRuntime.ts` for any symbol that another file currently imports from `@/lib/chatRuntime`, so existing public surface is preserved.
3. Update direct imports of the moved symbols across the codebase to point at `@/lib/chatRuntime/resolution`. As of the audit, the only external file that imports from `@/lib/chatRuntime` is `web/src/app/api/chat/route.ts`, and it currently imports `buildChatRuntime` / `ChatRuntimeResult` (neither is being moved); confirm via repo-wide grep before/after the move and list any additional callsites discovered. If no external callsite imports a moved symbol, document that finding in the slice-completion note rather than touching unrelated files.
4. Verify no new circular imports are introduced by the split (see Acceptance criteria for the explicit check).

## Changed files expected
- `web/src/lib/chatRuntime.ts` (moved bodies removed; re-exports added if needed)
- `web/src/lib/chatRuntime/resolution.ts` (new)
- Any direct-import callsite of a moved symbol identified by Step 3's grep. Expected at audit time: none beyond `chatRuntime.ts` itself, since `web/src/app/api/chat/route.ts` only imports `buildChatRuntime`/`ChatRuntimeResult`. If Step 3 finds additional callsites, append them to this list in the slice-completion note.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/resolution.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] A repo-wide `grep -rn "from \"@/lib/chatRuntime/resolution\"" web/src` shows every direct importer of a moved symbol resolves from `@/lib/chatRuntime/resolution`, while symbols still imported from `@/lib/chatRuntime` continue to resolve via the back-compat re-exports (verified by `npm run typecheck` succeeding without changing those callsites).
- [ ] `npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` (run from `web/`) reports no circular dependency involving `chatRuntime.ts` ↔ `chatRuntime/resolution.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is baseline-aware per loop protocol.

### Medium
- [x] Expand `Changed files expected` to include the direct-import callsites Step 3 says will be updated, not only `chatRuntime.ts` and `chatRuntime/resolution.ts`.
- [x] Add an acceptance criterion that makes Step 3 testable by requiring direct imports of the moved symbols to resolve from `web/src/lib/chatRuntime/resolution.ts` while back-compat re-exports from `web/src/lib/chatRuntime.ts` remain intact.

### Low
- [x] Add an explicit gate or acceptance check for the “no circular imports” requirement in Step 4 instead of leaving it as an unverified instruction.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:25:18Z, so its auditor notes are current.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:25:18Z, so its auditor notes are current.
