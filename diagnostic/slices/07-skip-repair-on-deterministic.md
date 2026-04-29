---
slice_id: 07-skip-repair-on-deterministic
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T18:00:00Z
---

## Goal
Lock in via regression test the existing invariant that the LLM SQL-repair pass (`repairSqlWithAnthropic`) is never invoked when the SQL came from a deterministic source. The route already enforces this: the SQL-exec-failure recovery branch in `web/src/app/api/chat/route.ts` only enters the `repairSqlWithAnthropic` block when `generationSource === "anthropic"`, and `assertNoLlmForDeterministic({ callSite: "repairSqlWithAnthropic" })` is wired in as a defense-in-depth dev-only throw. This slice ships only a new node:test file that locks the behavior in; no production code changes.

## Decisions
- **Reframed scope (round 2 audit response).** The original goal — "skip an LLM-based JSON-repair pass on clean JSON" — does not match the codebase. `parseSqlJsonPayload` / `parseAnswerJsonPayload` in `web/src/lib/anthropic.ts` already try `JSON.parse(...)` first and only fall through to a *local* deterministic recovery (`recoverSqlFromTruncatedJsonPayload`). There is no LLM-based JSON-repair pass in the chat flow. The only LLM "repair" call is `repairSqlWithAnthropic` (a SQL repair), invoked only after SQL execution fails, in `web/src/app/api/chat/route.ts`. Given the slice ID `skip-repair-on-deterministic`, the consistent reframe is: prove via test that this LLM SQL-repair call is skipped when the original SQL came from a deterministic template/heuristic. No code change is required because the if-guard at `route.ts` already implements the skip; this slice locks that in with a regression test.
- **No production-code edit.** The existing `assertNoLlmForDeterministic` helper plus the `if (generationSource === "anthropic")` gate are sufficient. Adding any new "skip" logic would be redundant and would risk regressing already-merged invariants from `slice/07-zero-llm-path-tighten`.

## Inputs
- `web/src/app/api/chat/route.ts` — owner of the SQL-exec-failure recovery branch (around line 644–716) that contains the `repairSqlWithAnthropic` call site gated on `generationSource === "anthropic"`.
- `web/src/lib/zeroLlmGuard.ts` — `assertNoLlmForDeterministic` helper.
- `web/scripts/tests/zero-llm-path.test.mjs` — existing harness pattern (TS-transpile + stubs) to mirror for the new test.

## Prior context
- `diagnostic/_state.md`
- `web/scripts/tests/zero-llm-path.test.mjs` (harness pattern, anthropic stub with `__getAnthropicCounter` / `__setRepairSqlImpl`, queries stub with `__setRunReadOnlySqlImpl`).

## Required services / env
None — the test loads the route module under TS transpile + stubs, like `zero-llm-path.test.mjs`. No DB, no live ANTHROPIC_API_KEY required.

## Steps
1. **Verify (do not edit)** the existing guard structure in `web/src/app/api/chat/route.ts`:
   - The SQL-exec-failure recovery branch (search for `chat_query_first_attempt_failed` and the surrounding `try { result = await executeSqlWithTrace(...) } catch (execError) { ... }` block) must continue to gate `repairSqlWithAnthropic(...)` behind `if (generationSource === "anthropic")`. The `deterministic_template` branch must continue to fall back to `buildHeuristicSql` and re-execute — without invoking `repairSqlWithAnthropic`.
   - If this structure has changed since the audit (it should not have — no production-code edits in this slice), STOP and re-open the slice's plan. Otherwise proceed.
2. **Add `web/scripts/tests/skip-repair.test.mjs`.** Mirror the harness setup in `web/scripts/tests/zero-llm-path.test.mjs`:
   - Re-use the same stub strings (`NEXT_SERVER_STUB`, `ANTHROPIC_STUB`, `QUERIES_STUB`, `DETERMINISTIC_SQL_STUB`, `CHAT_RUNTIME_STUB`, `CHAT_QUALITY_STUB`, `ANSWER_SANITY_STUB`, `SERVER_LOG_STUB`, `PERF_TRACE_STUB`, `ZERO_LLM_GUARD_STUB`) and the same `loadRouteHarness` / `withRoute` / `resetAll` / `makeFakeRuntime` / `postChat` shape. You may either copy them inline into the new file (preferred — keeps the test self-contained per the existing convention) or factor them into a shared helper if the maintainer accepts that scope; default to inline copy.
   - Add THREE `node:test` cases with EXACT names so acceptance criteria can match them:
     1. `deterministic SQL exec failure falls back to heuristic without invoking LLM repair`
        - Set `__setBuildDeterministicSqlTemplateImpl(() => ({ templateKey: DETERMINISTIC_KEYS[0], sql: "SELECT 1 FROM core.sessions WHERE session_key = 9839" }))`.
        - Set `__setBuildChatRuntimeImpl(async () => makeFakeRuntime({ sessionKey: 9839 }))`.
        - Set `__setRunReadOnlySqlImpl` to throw on the first call (any Error with a representative message, e.g. `new Error("simulated SQL exec failure")`) and succeed on the second call returning `{ sql, rows: [{ stub_col: 1 }], rowCount: 1, elapsedMs: 1, truncated: false }`.
        - Run under `withNodeEnv("production", () => postChat(loaded))` so the dev-throw guard is suppressed (this exercises the if-guard in `route.ts`, which is what the test is locking in — production behavior).
        - Assert `status === 200`.
        - Assert `body.generationSource === "heuristic_after_template_failure"` (the fall-back source set by `route.ts` when a deterministic template's SQL fails).
        - Assert `loaded.anthropic.__getAnthropicCounter() === 0` — proving no LLM call (and specifically no `repairSqlWithAnthropic` call) was made on the deterministic-source failure path.
     2. `anthropic SQL exec failure invokes LLM repair (positive control)`
        - Negative control: prove the harness CAN observe a repair call when the source is `anthropic`.
        - Set `__setGenerateSqlImpl(async () => ({ sql: "SELECT 1 FROM core.sessions WHERE session_key = 100", reasoning: "stub", model: "stub-anthropic-model" }))`.
        - Set `__setRepairSqlImpl(async () => ({ sql: "SELECT 1 FROM core.sessions WHERE session_key = 100", reasoning: "stub-repair", model: "stub-anthropic-model" }))`.
        - Set `__setSynthesizeImpl(async () => ({ answer: "stub", reasoning: "stub" }))`.
        - Set `__setRunReadOnlySqlImpl` to throw on the first call and succeed on the second.
        - Set `__setBuildChatRuntimeImpl(async () => makeFakeRuntime({ sessionKey: 100 }))` and leave `__setBuildDeterministicSqlTemplateImpl` unset so it returns `null` (forcing the anthropic generation path).
        - Run under `withNodeEnv("production", () => postChat(loaded))`.
        - Assert `status === 200`.
        - Assert `body.generationSource === "anthropic_repaired"`.
        - Assert `loaded.anthropic.__getAnthropicCounter() >= 2` — at least one generate call AND one repair call (and possibly one synthesize). The strict lower bound of 2 is sufficient because every stub increments the same shared counter.
     3. `dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development`
        - Direct unit test of the guard, mirroring the equivalent test in `zero-llm-path.test.mjs` but scoped to the `repairSqlWithAnthropic` callSite specifically (no route harness needed).
        - Use the same `withGuardModule` / `loadGuardModule` pattern as `zero-llm-path.test.mjs` to load `web/src/lib/zeroLlmGuard.ts` via TS transpile.
        - Assert `mod.assertNoLlmForDeterministic({ generationSource: "deterministic_template", templateKey: "any-key", callSite: "repairSqlWithAnthropic" })` throws an Error whose `.message` matches `/zero-llm-path/` AND includes `"repairSqlWithAnthropic"` AND includes `"any-key"`.

## Changed files expected
- `web/scripts/tests/skip-repair.test.mjs` (new test file only)

No production-code files change. If the implementer finds themselves about to edit any `.ts` / `.tsx` / `.mjs` outside `web/scripts/tests/`, STOP — that is a scope violation per the Decisions section above.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

Note: `npm run test:grading` resolves to `node --test scripts/tests/*.test.mjs` (see `web/package.json`), so the new `web/scripts/tests/skip-repair.test.mjs` file is picked up automatically by that gate — no script wiring is required.

## Acceptance criteria
- [ ] `npm run test:grading` reports `skip-repair.test.mjs > deterministic SQL exec failure falls back to heuristic without invoking LLM repair` as `ok`, with the test asserting `body.generationSource === "heuristic_after_template_failure"` AND `__getAnthropicCounter() === 0` after a deterministic-template request whose first SQL execution throws.
- [ ] `npm run test:grading` reports `skip-repair.test.mjs > anthropic SQL exec failure invokes LLM repair (positive control)` as `ok`, with the test asserting `body.generationSource === "anthropic_repaired"` AND `__getAnthropicCounter() >= 2` (i.e. the LLM repair stub was reached at least once) after an anthropic-source request whose first SQL execution throws.
- [ ] `npm run test:grading` reports `skip-repair.test.mjs > dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development` as `ok`, with the test asserting the guard throws an Error matching `/zero-llm-path/` whose message includes both `"repairSqlWithAnthropic"` and the supplied `templateKey`.
- [ ] All three subtests above appear in the `npm run test:grading` summary output (proves the file was picked up by the `node --test scripts/tests/*.test.mjs` glob).
- [ ] No files outside `web/scripts/tests/skip-repair.test.mjs` are modified by this slice (proven by `git diff --name-only main...HEAD` listing only that path).

## Out of scope
- Editing any production module (`web/src/**`). If a future slice wants to refactor `route.ts`'s repair branch (e.g. extract the if-guard into a named function), that belongs in its own slice, not here.
- Adding a JSON-repair fast-path. No such LLM-based JSON repair exists in the codebase; do not add one.
- Modifying `web/scripts/tests/zero-llm-path.test.mjs`. This slice augments coverage; it does not refactor the existing harness.

## Risk / rollback
Risk: low — test-only change. If the new test is flaky or wrong, it is independently revertable.
Rollback: `git revert <commit>` (single commit removes the new test file).

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Make the new skip-repair assertions observable through a named gate by stating which `npm run test:grading` test target or harness path executes `web/scripts/tests/skip-repair.test.mjs`; otherwise the plan can pass its listed gates without proving either acceptance criterion.

### Medium
- [x] Rewrite the acceptance criteria so each one names the concrete test/assertion outcome the implementer must add, rather than only the runtime behavior (“zero repair calls” / “repair still runs”).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T17:02:57Z, so the auditor context is current.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite the slice around the real owner of the parse/repair flow: `web/src/lib/chatRuntime.ts` does not contain the named JSON-repair path, while the actual parse helpers are in `web/src/lib/anthropic.ts` and the only LLM repair call site in this flow is `web/src/app/api/chat/route.ts`.
- [x] Reconcile the goal with the current codebase before re-audit: the plan describes an LLM-based JSON-repair pass on clean JSON, but the present code path locally parses model JSON and only invokes `repairSqlWithAnthropic(...)` after SQL execution fails.

### Medium
- [x] Update `Inputs`, `Steps`, `Changed files expected`, and the new test strategy to match the corrected owner module(s); the current Node `--test` plan cannot prove the stated behavior against `chatRuntime.ts`.

### Low
- [ ] None.

### Notes (informational only — no action)
- Repo check: `rg -n "repairSqlWithAnthropic|JSON.parse" web/src` shows the parse helpers in `web/src/lib/anthropic.ts` and the LLM repair call site in `web/src/app/api/chat/route.ts`, not in `web/src/lib/chatRuntime.ts`.
