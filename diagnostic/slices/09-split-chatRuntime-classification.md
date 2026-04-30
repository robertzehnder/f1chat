---
slice_id: 09-split-chatRuntime-classification
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T15:00:00Z
---

## Goal
Extract the question-classification logic from chatRuntime.ts into chatRuntime/classification.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/classification.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts`. Concrete targets: the `QuestionType` type alias (line 21 at author time) and the `classifyQuestion` function (line 519 at author time). Line numbers are approximate snapshots — the implementer should locate by symbol name, not by line. Other helpers that take `QuestionType` (e.g. `shouldUseRuntimeFastPath`, `requiresResolvedSession`, `requiredTablesForQuestion`, `grainForQuestion`) stay in `chatRuntime.ts` and import `QuestionType` from the new file.
2. Move the targets in Step 1 to `web/src/lib/chatRuntime/classification.ts`. **Do not re-export them from `chatRuntime.ts`.** Rationale: `buildChatRuntime` is itself defined inside `chatRuntime.ts`, so its call site is protected by an in-file `import { classifyQuestion, type QuestionType } from './chatRuntime/classification'` — re-exports would only matter for external consumers, and Step 3 confirms there are none. (If re-exports were kept, `isolatedModules` in the Next.js tsconfig would force `export type { QuestionType } from './chatRuntime/classification'` syntax to avoid TS1205; this slice avoids that surface area entirely by dropping re-exports.)
3. Update direct imports of the moved symbols across the codebase to point at `@/lib/chatRuntime/classification`. Note: at author time a repo-wide grep shows no external file imports `classifyQuestion` or `QuestionType` from `@/lib/chatRuntime` (only `buildChatRuntime` / `ChatRuntimeResult` are imported externally, e.g. `web/src/app/api/chat/route.ts`). The implementer must re-run the grep at impl time; if any new external consumer has appeared since plan-revise, update it to import from `@/lib/chatRuntime/classification`.
4. Verify no circular imports. Concrete check: `cd web && npm run build` and `cd web && npm run typecheck` both succeed (Next.js / TypeScript fail loudly on cycles in the new module). No additional tooling required.

## Changed files expected
- `web/src/lib/chatRuntime.ts` (remove the moved bodies; add an internal `import { classifyQuestion, type QuestionType } from './chatRuntime/classification'` for the in-file callers; no re-exports of the moved symbols)
- `web/src/lib/chatRuntime/classification.ts` (new file: holds `QuestionType` and `classifyQuestion`)
- Any consumer file that directly imports `classifyQuestion` or `QuestionType` from `@/lib/chatRuntime` and is updated to import from `@/lib/chatRuntime/classification`. At author time a repo-wide grep finds zero such consumers (only `buildChatRuntime` / `ChatRuntimeResult` are imported externally). If implementation re-runs the grep and the set is still empty, this bullet collapses to zero files; otherwise enumerate them in the slice-completion note.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/classification.ts` exists and exports the moved symbols (`QuestionType`, `classifyQuestion`).
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies and does NOT re-export `QuestionType` / `classifyQuestion`; in-file callers reach them via `import { classifyQuestion, type QuestionType } from './chatRuntime/classification'`.
- [ ] Direct imports of `classifyQuestion` / `QuestionType` from `@/lib/chatRuntime` (if any exist) are updated to import from `@/lib/chatRuntime/classification`, matching Step 3.
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
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate uses the required baseline-aware wrapper from `diagnostic/_state.md`.

### Medium
- [x] Expand `Changed files expected` to include the import-consumer files Step 3 says will be updated, because the current scope lists only `chatRuntime.ts` and the new `classification.ts`.
- [x] Make Step 4 testable by naming the concrete check for circular imports or by removing that step if build/typecheck are the intended proof.

### Low
- [x] Add an acceptance criterion that direct imports of the moved symbols are updated to `web/src/lib/chatRuntime/classification.ts`, matching Step 3.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:05:46Z, so no stale-state note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: applied)**

### High
_None._

### Medium
- [x] Resolve the internal contradiction between Step 2 ("re-export them from `chatRuntime.ts` for back-compat (so `buildChatRuntime`'s call site keeps working without churn)") and AC #2 ("only re-exports if needed"): pick one stance. Note that `buildChatRuntime` is itself defined inside `chatRuntime.ts`, so its call site is protected by the in-file `import` from `./chatRuntime/classification`, not by a re-export — the re-exports only matter for external consumers, and Step 3 documents that none currently exist. Either commit to "always re-export `QuestionType` and `classifyQuestion` for forward-compat" (and update AC #2 to match) or commit to "drop the re-exports because no external consumers exist" (and update Step 2 + the `Changed files expected` line accordingly). Forced-findings ratchet escalation: this is the round-2 escalated item from Low — flagged because the implementer reading Step 2's parenthetical may keep re-exports for the wrong reason and propagate the same confusion into the slice-completion note.

### Low
- [x] Step 1 cites concrete line numbers (`QuestionType` at line 21, `classifyQuestion` at line 519). Add a one-liner that line numbers are approximate at author time and the implementer should locate by symbol name; no behavioral change required.
- [x] If TypeScript's `isolatedModules` is enabled in the web tsconfig (it usually is for Next.js apps), re-exporting a type alias requires `export type { QuestionType } from './chatRuntime/classification'` (or `export { type QuestionType, classifyQuestion } from ...`). Consider naming the expected re-export syntax in Step 2 so the implementer doesn't hit TS1205 mid-impl.

### Notes (informational only — no action)
- Round-2 forced-findings ratchet applied: round 1's items are all resolved cleanly and the plan is in genuinely good shape; the Medium above is escalated from Low to ensure the reviser receives concrete guidance per the role prompt. If the planner picks the "drop re-exports" stance, recheck that no external consumer of `classifyQuestion` / `QuestionType` lands between plan-revise and impl.
- Gate command order (`build` then `typecheck`) is suboptimal (typecheck is faster and `next build` already runs its own type pass), but not a correctness bug — leaving as-is.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
_None._

### Medium
_None._

### Low
_None._

### Notes (informational only — no action)
- Round-1 and round-2 items are all cleanly resolved. The re-export stance is now committed to "do not re-export" with rationale (in-file callers reach the moved symbols via `import { classifyQuestion, type QuestionType } from './chatRuntime/classification'`); Step 2, AC #2, and `Changed files expected` are mutually consistent. Step 1's line-number caveat and the isolatedModules/TS1205 footnote are recorded. Step 3 + AC #3 align with the no-external-consumers grep, with implementer instructed to re-grep at impl time. Gate set uses the baseline-aware wrapper (`bash scripts/loop/test_grading_gate.sh`).
- Round 3 is the final claude self-audit round per `LOOP_CLAUDE_PLAN_AUDIT_CAP`. Handoff to codex for final external plan audit.
