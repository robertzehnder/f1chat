---
slice_id: 07-skip-repair-on-deterministic
phase: 7
status: blocked
owner: user
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T13:34:06-04:00
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
   - **Async-aware `withNodeEnv` helper (round 3 audit fix).** Do NOT copy the synchronous `withNodeEnv(value, fn)` shape from `zero-llm-path.test.mjs` (it returns the inner Promise from `try`, which means the `finally` resets `NODE_ENV` before any awaited SQL-repair / heuristic-fallback work inside the callback completes). Instead, define and use an `async` variant in the new test file:
     ```js
     async function withNodeEnv(value, fn) {
       const original = process.env.NODE_ENV;
       process.env.NODE_ENV = value;
       try {
         return await fn();
       } finally {
         process.env.NODE_ENV = original;
       }
     }
     ```
     All three test cases below MUST invoke this helper as `await withNodeEnv("production", async () => { ... await postChat(loaded) ... })` (or equivalently, `await withNodeEnv("production", () => postChat(loaded))` is acceptable ONLY because the `await fn()` inside the helper now waits for the returned Promise before running the `finally`). If you prefer to skip the helper entirely, an inline `try/finally` around an awaited call is also acceptable, e.g.:
     ```js
     const original = process.env.NODE_ENV;
     process.env.NODE_ENV = "production";
     try {
       const { status, body } = await postChat(loaded);
       // assertions...
     } finally {
       process.env.NODE_ENV = original;
     }
     ```
     Either shape proves the production-only branch (`generationSource === "anthropic"` gate around `repairSqlWithAnthropic`) is exercised end-to-end with `NODE_ENV=production` held across every awaited boundary inside the route handler.
   - Add THREE `node:test` cases with EXACT names so acceptance criteria can match them:
     1. `deterministic SQL exec failure falls back to heuristic without invoking LLM repair`
        - Set `__setBuildDeterministicSqlTemplateImpl(() => ({ templateKey: DETERMINISTIC_KEYS[0], sql: "SELECT 1 FROM core.sessions WHERE session_key = 9839" }))`.
        - Set `__setBuildChatRuntimeImpl(async () => makeFakeRuntime({ sessionKey: 9839 }))`.
        - Set `__setRunReadOnlySqlImpl` to throw on the first call (any Error with a representative message, e.g. `new Error("simulated SQL exec failure")`) and succeed on the second call returning `{ sql, rows: [{ stub_col: 1 }], rowCount: 1, elapsedMs: 1, truncated: false }`.
        - Invoke as `const { status, body } = await withNodeEnv("production", async () => postChat(loaded));` using the **async-aware** helper defined above (or an inline `try/finally` around an awaited `postChat(loaded)`). Either shape MUST hold `NODE_ENV=production` across the entire awaited route handler so the dev-throw guard stays suppressed for the full SQL-exec-failure → heuristic fallback path; this is what exercises the production if-guard the slice locks in.
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
        - Invoke as `const { status, body } = await withNodeEnv("production", async () => postChat(loaded));` using the **async-aware** helper (or inline `try/finally` around an awaited call). The production env MUST stay set across the awaited generate → SQL-exec → repair → re-execute → synthesize chain, otherwise the production-only `repairSqlWithAnthropic` branch is not reliably exercised.
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
- [ ] No files outside `web/scripts/tests/skip-repair.test.mjs` are modified by this slice (proven by `git diff --name-only integration/perf-roadmap...HEAD` listing only that path — this is the loop's required diff base, since the dispatcher mirrors slice work onto `integration/perf-roadmap`).

## Out of scope
- Editing any production module (`web/src/**`). If a future slice wants to refactor `route.ts`'s repair branch (e.g. extract the if-guard into a named function), that belongs in its own slice, not here.
- Adding a JSON-repair fast-path. No such LLM-based JSON repair exists in the codebase; do not add one.
- Modifying `web/scripts/tests/zero-llm-path.test.mjs`. This slice augments coverage; it does not refactor the existing harness.

## Risk / rollback
Risk: low — test-only change. If the new test is flaky or wrong, it is independently revertable.
Rollback: `git revert <commit>` (single commit removes the new test file).

## Slice-completion note

- Branch: `slice/07-skip-repair-on-deterministic`
- Base: `integration/perf-roadmap` (fetched fresh; current head 4320c3a after plan-approved commit)
- Commits added by this slice: one commit (see HEAD `[slice:07-skip-repair-on-deterministic][awaiting-audit]`).
- Production code: zero edits. Verified via `git diff --name-only integration/perf-roadmap...HEAD` listing only `web/scripts/tests/skip-repair.test.mjs` (plus this slice file).
- Verification of pre-existing route guard structure (Step 1):
  - `web/src/app/api/chat/route.ts:655` retains `if (generationSource === "anthropic")` gating the `repairSqlWithAnthropic(...)` block.
  - `web/src/app/api/chat/route.ts:657-661` retains `assertNoLlmForDeterministic({ callSite: "repairSqlWithAnthropic" })` defense-in-depth.
  - `web/src/app/api/chat/route.ts:705-712` retains the `else if (generationSource === "deterministic_template")` heuristic-fallback branch that does NOT call any LLM.
- Test file: `web/scripts/tests/skip-repair.test.mjs` (new, only file added).
- Three node:test cases all `ok` with the EXACT names required by the acceptance criteria:
  1. `deterministic SQL exec failure falls back to heuristic without invoking LLM repair` — asserts `body.generationSource === "heuristic_after_template_failure"` AND `__getAnthropicCounter() === 0`.
  2. `anthropic SQL exec failure invokes LLM repair (positive control)` — asserts `body.generationSource === "anthropic_repaired"` AND `__getAnthropicCounter() >= 2`.
  3. `dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development` — asserts the guard throws with `/zero-llm-path/`, `repairSqlWithAnthropic`, and the supplied templateKey in the message.

### Decisions made during implementation
- **`__answerCacheTestHooks.synthesize` no-op (Test 1 only).** When the deterministic template's first SQL throws, `route.ts` transitions `generationSource` to `"heuristic_after_template_failure"` and (because rowCount > 0 on the heuristic re-execution per slice instruction `rowCount: 1`) enters the post-recovery `cachedSynthesize(...)` branch at `route.ts:743`. The shared `__getAnthropicCounter()` would otherwise be incremented by the synth call (the anthropic stub bumps the counter before checking its impl), making the slice's literal `=== 0` assertion impossible to satisfy without modifying production code or contradicting the slice's specified stub return values. To preserve the slice's intent (the counter as a clean signal for repair/generate calls only) within the test-only scope, the test installs a no-op via `loaded.answerCache.__answerCacheTestHooks.synthesize`. This hook is the existing DI seam already exported by `web/src/lib/cache/answerCache.ts` (`__answerCacheTestHooks`) for test substitution; setting it does not modify production code. The route still walks the full `heuristic_after_template_failure` branch end-to-end (verified by the `body.generationSource === "heuristic_after_template_failure"` assertion).
- **Async-aware `withNodeEnv`.** Implemented as the round-3 audit fix specified — `async function withNodeEnv(value, fn) { ... return await fn(); ... finally { ... } }` — and used as `await withNodeEnv("production", async () => postChat(loaded))` in both route tests so `NODE_ENV=production` is held across every awaited boundary inside the route handler.
- **Stub strings.** Copied inline verbatim from `web/scripts/tests/zero-llm-path.test.mjs` (NEXT_SERVER_STUB, ANTHROPIC_STUB, QUERIES_STUB, DETERMINISTIC_SQL_STUB, CHAT_RUNTIME_STUB, CHAT_QUALITY_STUB, ANSWER_SANITY_STUB, SERVER_LOG_STUB, PERF_TRACE_STUB, ZERO_LLM_GUARD_STUB) per the slice's "default to inline copy" guidance. `loadRouteHarness`/`withRoute`/`resetAll`/`makeFakeRuntime`/`postChat` likewise inlined.
- **`DETERMINISTIC_KEYS` slimmed.** The new test file only references `DETERMINISTIC_KEYS[0]`, so a 3-entry constant suffices (full 32-key list is unnecessary here; that list lives in zero-llm-path.test.mjs and is unaffected).

### Gate command results (run from `/Users/robertzehnder/.openf1-loop-worktrees/07-skip-repair-on-deterministic/web`)

1. `npm run build` — exit 0. Next.js production build completed.
2. `npm run typecheck` — exit 0. `tsc --noEmit` clean.
3. `npm run test:grading` — exit 1 overall, but **all three new subtests pass**:
   - `ok 67 - deterministic SQL exec failure falls back to heuristic without invoking LLM repair`
   - `ok 68 - anthropic SQL exec failure invokes LLM repair (positive control)`
   - `ok 69 - dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development`

   The 3 failures (`Case A: DB_*-branch probe-failure + opt-in engages PGlite`, `Case B: DATABASE_URL unreachable + opt-in engages PGlite`, `Case E: NEON_DB_HOST unreachable + opt-in engages PGlite`) are **pre-existing on `integration/perf-roadmap`**, unrelated to this slice. Verified by `git stash`-ing this slice's changes and re-running `npm run test:grading`: the same three Case A/B/E tests fail with identical error `[db] using local PGlite fallback (reason=probe-failed): connect ECONNREFUSED 127.0.0.1:1`. They originate from `slice/06-driver-swap-local-fallback` and depend on the local environment being able to bind/connect to the dummy host the test uses; this worktree's environment cannot, so those tests fail before my slice ran. They are not in scope for this test-only slice.

### Self-check vs acceptance criteria
- [x] `npm run test:grading` reports `skip-repair.test.mjs > deterministic SQL exec failure falls back to heuristic without invoking LLM repair` as `ok` with the required assertions — confirmed (subtest #67).
- [x] `npm run test:grading` reports `skip-repair.test.mjs > anthropic SQL exec failure invokes LLM repair (positive control)` as `ok` with the required assertions — confirmed (subtest #68; observed counter is 3 = generate + repair + synthesize, satisfying the `>= 2` assertion).
- [x] `npm run test:grading` reports `skip-repair.test.mjs > dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development` as `ok` with the required assertions — confirmed (subtest #69).
- [x] All three subtests appear in the `npm run test:grading` summary output — confirmed; the `node --test scripts/tests/*.test.mjs` glob picked up the new file (subtests numbered 67, 68, 69 within the 75-subtest run).
- [x] `git diff --name-only integration/perf-roadmap...HEAD` lists only `web/scripts/tests/skip-repair.test.mjs` and this slice file (`diagnostic/slices/07-skip-repair-on-deterministic.md`) — confirmed at commit time.

## Blocked diagnosis (round 2 — after re-running gates 2026-04-29T13:34:06-04:00)

This slice is set `status=blocked, owner=user` because the only outstanding auditor objection — `npm run test:grading` exits non-zero — cannot be resolved within this slice's declared scope.

### Re-run results in this worktree

Re-ran all three gates from `/Users/robertzehnder/.openf1-loop-worktrees/07-skip-repair-on-deterministic/web` on 2026-04-29 with no code changes since the previous `awaiting-audit` commit `bcef68f`:

1. `npm run build` → exit `0`.
2. `npm run typecheck` → exit `0`.
3. `npm run test:grading` → exit `1`. 75 subtests; 62 pass, 3 fail, 10 skipped.

The three failing subtests are unchanged from the previous audit:

- `not ok 14 - Case A: DB_*-branch probe-failure + opt-in engages PGlite` (`web/scripts/tests/driver-fallback.test.mjs:223`)
- `not ok 15 - Case B: DATABASE_URL unreachable + opt-in engages PGlite` (`web/scripts/tests/driver-fallback.test.mjs:247`)
- `not ok 18 - Case E: NEON_DB_HOST unreachable + opt-in engages PGlite` (`web/scripts/tests/driver-fallback.test.mjs:306`)

Each fails with the same kernel-level error: `Error: connect ECONNREFUSED 127.0.0.1:1` thrown from `pg-pool/index.js:45` after the route already logged `[db] using local PGlite fallback (reason=probe-failed)`. The fallback log line is emitted by the slice-06 code path in `web/src/lib/db.ts`, then the same path immediately attempts a network connection that this environment cannot satisfy.

### Why this slice cannot fix it

The failing tests are NOT in the slice's scope:

- The slice's `Changed files expected` lists exactly one path: `web/scripts/tests/skip-repair.test.mjs`.
- The slice's `Out of scope` section explicitly states: *"Editing any production module (`web/src/**`)."*
- `git diff --name-only integration/perf-roadmap...HEAD` confirms only three paths changed by this slice: `diagnostic/_state.md` (append-only auditor note), `diagnostic/slices/07-skip-repair-on-deterministic.md` (this file), and `web/scripts/tests/skip-repair.test.mjs` (the new test).
- The failing test file `web/scripts/tests/driver-fallback.test.mjs` was added by `slice/06-driver-swap-local-fallback` (merged 2026-04-28; commit `205c23b`). The PGlite fallback runtime it exercises lives in `web/src/lib/db.ts`. Any fix must edit `web/src/lib/db.ts` (or the pglite/pg-pool boundary code), which is `web/src/**` and therefore out of scope.

### Independent reproduction on `integration/perf-roadmap`

Reproduced against the integration base from `/Users/robertzehnder/Documents/coding/f1/openf1` (currently checked out at `7d381d8`, the integration HEAD): `npm run test:grading` exits `1` with the same three Case A / Case B / Case E failures. (The integration worktree had a stale `node_modules` and additionally surfaced unrelated `Cannot find package 'lru-cache'` / `Cannot find package '@electric-sql/pglite'` resolution errors — the latter is the same fallback path: PGlite is being required despite not being installed in that worktree. After `npm install` the resolution errors would clear, leaving only the same Case A / B / E network failures.) These three are pre-existing on `integration/perf-roadmap`; this slice did not introduce them.

### Auditor accepted everything else

The previous `## Audit verdict` (immediately below) explicitly recorded:

- Scope diff → **PASS**.
- All four acceptance criteria → **PASS**, including the three new subtests `ok 67` / `ok 68` / `ok 69` and the "no out-of-scope code changes" criterion.
- The only stated rationale for REVISE: *"the required grading gate still exits non-zero in this environment; re-audit only after `npm run test:grading` is green end-to-end."*

That rationale conflicts with the slice's `Out of scope` clause: making the gate green requires fixing slice-06 code that this slice cannot touch.

### Action requested from user

Please decide one of:

1. **Permit a follow-up scope expansion** — e.g. opening a separate slice (suggested id: `slice/07-driver-fallback-pglite-fix` or merging into Phase 6 backlog) that fixes `web/src/lib/db.ts` so Case A / B / E pass, then re-run this slice's audit unchanged. This is the loop's normal pattern (one bug → one slice).
2. **Authorize the auditor to merge this slice on the existing evidence** — three new subtests pass, scope is clean, gate failures are documented as pre-existing and out-of-scope. Update the auditor instructions if a per-slice exception is acceptable.
3. **Mark Case A / B / E as environment-skipped** in `web/scripts/tests/driver-fallback.test.mjs` (e.g. `t.skip()` when a probe sentinel cannot bind) — this would also be a separate slice, since editing `driver-fallback.test.mjs` is outside this slice's `Changed files expected`.

No further action will be taken in this slice until the user replies. The branch `slice/07-skip-repair-on-deterministic` is pushed and reflects the same content the auditor reviewed; only the slice frontmatter (`status: blocked`, `owner: user`) and this diagnosis section are updated in the new commit.

## Audit verdict
**REVISE**

- Gate `cd web && npm run build` -> exit `0`.
- Gate `cd web && npm run typecheck` -> exit `0`.
- Gate `cd web && npm run test:grading` -> exit `1`.
- Gate `cd web && npm run test:grading` failure context -> `web/scripts/tests/driver-fallback.test.mjs:223`, `web/scripts/tests/driver-fallback.test.mjs:247`, `web/scripts/tests/driver-fallback.test.mjs:306` (`Case A`, `Case B`, `Case E` fail with `connect ECONNREFUSED 127.0.0.1:1` after logging `using local PGlite fallback`).
- Scope diff -> **PASS**. `git diff --name-only integration/perf-roadmap...HEAD` lists only `diagnostic/_state.md`, `diagnostic/slices/07-skip-repair-on-deterministic.md`, and `web/scripts/tests/skip-repair.test.mjs`; `_state.md` is an append-only addition under `## Notes for auditors`, and the other two paths are in scope.
- Acceptance: `deterministic SQL exec failure falls back to heuristic without invoking LLM repair` -> **PASS** (`web/scripts/tests/skip-repair.test.mjs:311`; `npm run test:grading` subtest `ok 67`).
- Acceptance: `anthropic SQL exec failure invokes LLM repair (positive control)` -> **PASS** (`web/scripts/tests/skip-repair.test.mjs:358`; `npm run test:grading` subtest `ok 68`).
- Acceptance: `dev-throw — assertNoLlmForDeterministic blocks repairSqlWithAnthropic callSite under NODE_ENV=development` -> **PASS** (`web/scripts/tests/skip-repair.test.mjs:406`; `npm run test:grading` subtest `ok 69`).
- Acceptance: all three subtests appear in the grading summary -> **PASS** (`ok 67`, `ok 68`, `ok 69` in the `npm run test:grading` run).
- Acceptance: no out-of-scope code changes -> **PASS**. No production files changed.
- Decision -> **REVISE**.
- Rationale -> The slice is not merge-ready because the required grading gate still exits non-zero in this environment; re-audit only after `npm run test:grading` is green end-to-end.

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

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Make the planned route tests hold `NODE_ENV=production` across the awaited `postChat(...)` work by using an async-aware env wrapper (or inline `try/finally` around an awaited call); the cited `withNodeEnv("production", () => postChat(loaded))` shape resets `NODE_ENV` before the later SQL-repair / heuristic-fallback awaits execute, so it does not reliably exercise the intended production-only branch.

### Medium
- [x] Replace the final scope-proof acceptance criterion’s `git diff --name-only main...HEAD` with the loop’s required diff base `git diff --name-only integration/perf-roadmap...HEAD`, so the slice proves file scope against the branch the dispatcher mirrors from.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T17:02:57Z, so the auditor context is current.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T17:02:57Z, so the auditor context is current.
