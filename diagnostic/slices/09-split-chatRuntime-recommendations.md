---
slice_id: 09-split-chatRuntime-recommendations
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T15:14:36Z
---

## Goal
Extract follow-up recommendation logic from chatRuntime.ts into chatRuntime/recommendations.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/recommendations.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts` (e.g., `isFollowUp` and any related follow-up recommendation helpers/types).
2. Move them to `web/src/lib/chatRuntime/recommendations.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Run `rg "isFollowUp|<other moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/chatRuntime/recommendations` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/chatRuntime.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports: the new file must not import from `web/src/lib/chatRuntime.ts`. Confirm `cd web && npm run build` and `cd web && npm run typecheck` succeed (both fail loudly on circular ESM resolution).

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/recommendations.ts`
- Any additional `web/src/**` files surfaced by the Step 3 ripgrep that directly import the moved symbols (expected to be zero based on a pre-plan scan, but the implementer must extend this list if Step 3 finds external import sites).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/recommendations.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Every direct import of the moved symbols in `web/src/**` resolves from `web/src/lib/chatRuntime/recommendations.ts` (verified by the Step 3 ripgrep, whose result is recorded in the Slice-completion note).
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` succeed, which is the proof-of-record that no circular import was introduced between `chatRuntime.ts` and `chatRuntime/recommendations.ts`.
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
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` in Gate commands with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop-approved grading wrapper instead of failing on known baseline issues.
- [x] Expand `Changed files expected` to cover the import sites Step 3 requires, or narrow Step 3 so the declared file scope matches the planned edits.

### Low
- [x] Add an acceptance criterion that makes Step 3 and Step 4 auditable by requiring all direct imports to resolve from `web/src/lib/chatRuntime/recommendations.ts` and the referenced gate(s) to be the proof that no circular import was introduced.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:09:50Z, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:09:50Z, so no stale-state note is needed.
