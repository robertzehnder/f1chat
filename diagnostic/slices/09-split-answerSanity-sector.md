---
slice_id: 09-split-answerSanity-sector
phase: 9
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T14:51:26-04:00
---

## Goal
Extract sector sanity checks from answerSanity.ts into answerSanity/sector.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/sector.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts` (notably `buildSectorAnswer` and any sector-only helpers/types it relies on).
2. Move them to `web/src/lib/answerSanity/sector.ts` and import them back into `web/src/lib/answerSanity.ts` at their existing call sites. The moved symbols are internal helpers (no current external consumers — repo search confirms `@/lib/answerSanity` is only imported as a barrel from `web/src/app/api/chat/orchestration.ts`, and that file imports `applyAnswerSanityGuards` / `buildStructuredSummaryFromRows`, not the sector helpers), so no consumer-side import rewrites are required and no public re-export is added.
3. Verify no circular imports between `answerSanity.ts` and `answerSanity/sector.ts`.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/sector.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/sector.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

- Branch: `slice/09-split-answerSanity-sector`
- Parent commit: `6e9275a` (plan-approved)
- Implementation commit: `d813f71` (the slice-completion note in that commit referenced its own hash with a placeholder; this follow-up commit on the same branch records the final hash)
- Changes:
  - Created `web/src/lib/answerSanity/sector.ts` exporting `buildSectorAnswer`. The new module also defines local copies of the helpers `buildSectorAnswer` depends on (`asNumber`, `asString`, `driverLabel`), matching the established pattern in `web/src/lib/answerSanity/pitStints.ts` (which is the only other existing sub-module).
  - Removed the `buildSectorAnswer` body from `web/src/lib/answerSanity.ts` and replaced it with `import { buildSectorAnswer } from "./answerSanity/sector";` so the existing call site in `applyAnswerSanityGuards` (the `if (lowerQuestion.includes("sector"))` branch) keeps the same identifier.
  - No public re-export was added: repo search confirmed `buildSectorAnswer` is only referenced inside `answerSanity.ts` itself (no other files import it from the barrel), and the only `@/lib/answerSanity` consumer (`web/src/app/api/chat/orchestration.ts`) uses `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows`.
- Decisions:
  - Followed the pitStints precedent of duplicating shared helpers (`asNumber`, `asString`, `driverLabel`) into the sub-module instead of extracting a shared util file. Extracting a shared helpers module is out of scope per the slice's "Out of scope: Behavioral changes — this is a pure mechanical split."
  - Did not add a re-export for `buildSectorAnswer` from `answerSanity.ts` because it has no external consumers (slice Step 2 explicitly calls this out).
- Self-checks:
  - `grep -rn "buildSectorAnswer" --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js'` after the edit shows only `web/src/lib/answerSanity.ts` (import + call site) and `web/src/lib/answerSanity/sector.ts` (definition) — no stale references.
  - `grep -n "answerSanity" web/src/lib/answerSanity/{sector,pitStints}.ts` returns nothing, confirming no circular import back to the parent module.
  - File scope respected: only the two files in `Changed files expected` (`web/src/lib/answerSanity.ts`, `web/src/lib/answerSanity/sector.ts`) plus this slice file are modified.
- Gate results:
  - `cd web && npm run build` → exit 0 (Next.js build + lint + type-check passed; `npm install` was run first because `web/node_modules` was empty in this worktree).
  - `cd web && npm run typecheck` → exit 0 (`tsc --noEmit` clean).
  - `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`).

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace the raw grading gate `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware wrapper from `diagnostic/_state.md:69` instead of a repo-wide gate that can fail on unrelated known breakage (`diagnostic/slices/09-split-answerSanity-sector.md:37`).

### Low
- [x] Reconcile Step 3 with the declared file scope: either name the concrete consumer files expected to change for import rewrites or narrow/remove the step if the split remains barrel-only, because the plan currently says it will update direct imports across the codebase while `Changed files expected` lists only the two library files (`diagnostic/slices/09-split-answerSanity-sector.md:27`, `diagnostic/slices/09-split-answerSanity-sector.md:30`).

### Notes (informational only — no action)
- The current repo search shows `@/lib/answerSanity` is imported from `web/src/app/api/chat/orchestration.ts`, but that is a barrel import, not a direct `answerSanity/sector` consumer.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current at audit time (`last updated: 2026-04-30T18:46:04Z`).
- Repo search still shows `@/lib/answerSanity` imported from `web/src/app/api/chat/orchestration.ts` and no `answerSanity/sector` consumers, which matches the narrowed file scope.
