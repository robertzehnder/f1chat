---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T12:15:59-04:00
---

## Goal
Audit and tighten the deterministic-only path: questions that resolve fully via the deterministic SQL template registry must NOT call any LLM **in any environment** — neither SQL generation, nor repair, nor answer synthesis (`cachedSynthesize`). Today the cold deterministic path still invokes `cachedSynthesize` after deterministic SQL execution succeeds (`web/src/app/api/chat/route.ts:719`); only the warm answer-cache-hit short-circuit (`web/src/app/api/chat/route.ts:467`) is currently zero-LLM. This slice (a) makes the production deterministic branch bypass `cachedSynthesize` and synthesize the answer deterministically via the existing row-structured `buildFallbackAnswer` helper (`web/src/app/api/chat/route.ts:68`), (b) adds a dev-only runtime assertion (`NODE_ENV !== "production"`) — implemented in a new dependency-light module `web/src/lib/zeroLlmGuard.ts` so its unit tests can transpile-and-import it without alias rewriting — that throws if a deterministic-eligible request reaches an LLM transport, and (c) locks the behavior in with tests covering cold deterministic, warm (answer-cache-hit) deterministic, an LLM-required negative control, the dev-throw, and the production no-throw.

## Inputs
- `web/src/lib/deterministicSql.ts` — canonical template registry (per Phase 5 audit; no `web/src/lib/templates/` directory exists).
- `web/src/lib/chatRuntime.ts` — runtime resolver-skip fast paths (read-only — the new assertion helper lives in a separate dep-light module so the unit test does not have to rewrite `@/lib/queries`, `@/lib/resolverCache`, `@/lib/perfTrace` imports).
- `web/src/app/api/chat/route.ts` — actual LLM call sites (`generateSqlWithAnthropic`, `repairSqlWithAnthropic`, `cachedSynthesize`) and answer-cache short-circuit.
- `web/src/lib/anthropic.ts` — LLM transport (used by tests as the single mock/spy seam).
- `web/src/lib/cache/answerCache.ts` — answer-cache key / read path that defines today's only zero-LLM short-circuit.
- `web/src/lib/zeroLlmGuard.ts` — **new file**, dependency-light home of the dev-only `assertNoLlmForDeterministic` helper added by this slice. Imports nothing from `@/lib/*`; only reads `process.env.NODE_ENV` and its arguments. This isolation is deliberate: it lets the helper unit test transpile-and-import the module via `typescript.transpileModule` with zero alias rewriting (the auditor round-8 Medium concern).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/notes/05-template-cache-coverage.md` — Phase 5 audit; the canonical inventory of the 32 deterministic templates and the basis for "deterministic-eligible" in this slice (its `## Coverage table` is the seed list; every row whose disposition is `future-Y` or `future-Y, with TTL/invalidation` is in scope here).

## Required services / env
None at author time. Tests must work with `NODE_ENV=test` and without an `ANTHROPIC_API_KEY` and **without a running Postgres** — the test never opens a DB connection. Postgres independence is achieved via the same transpile + import-rewrite harness already in use by `web/scripts/tests/answer-cache.test.mjs` (see lines 47–61, 143–166): the test reads `web/src/app/api/chat/route.ts` from disk, rewrites its `@/lib/queries`, `@/lib/anthropic`, `@/lib/deterministicSql`, `@/lib/chatRuntime`, `@/lib/cache/answerCache`, and `next/server` imports to local in-process stubs, transpiles via `typescript.transpileModule`, and imports the resulting `route.mjs`. The `queries.stub.mjs` exports a configurable `runReadOnlySql` (initialized via `__setRunReadOnlySqlImpl(fn)`) so deterministic SQL execution returns canned rows in-memory; no `DATABASE_URL` / `POOLED_DATABASE_URL` is consulted. The assertion-trip test uses `NODE_ENV=development` to exercise the throw; the no-throw test uses `NODE_ENV=production`.

## Steps
1. Enumerate deterministic-eligible templates from `diagnostic/notes/05-template-cache-coverage.md` (the 32-row coverage table) and cross-check against the `templateKey: "..."` literals in `web/src/lib/deterministicSql.ts`. Codify this list in the test file as a single exported constant **named exactly `DETERMINISTIC_KEYS`** (e.g. `export const DETERMINISTIC_KEYS = ["...", ...];`) so the drift gate (see `## Gate commands`) can scope its extraction to that block and so future drift is caught.
2. **Production change — bypass `cachedSynthesize` for deterministic-template requests.** In `web/src/app/api/chat/route.ts`, replace the unconditional `cachedSynthesize` call inside the `if (result.rowCount > 0) { ... }` block (around `web/src/app/api/chat/route.ts:716`–`746`) with a branch:
   - When `generationSource === "deterministic_template"`, set `answer = buildFallbackAnswer({ question: message, rowCount: result.rowCount, rows: result.rows, caveatText })` and leave `answerReasoning` undefined; do NOT enter the `synthSpan`/`cachedSynthesize` block. This is unconditional (production AND non-production) — the goal is no LLM call, ever, on the deterministic branch.
   - For all other `generationSource` values, retain today's `cachedSynthesize` path unchanged.
   - Rationale (reuse `buildFallbackAnswer`): the helper already exists in the same file (`web/src/app/api/chat/route.ts:68`) and produces a row-structured deterministic answer via `buildStructuredSummaryFromRows`; introducing a new formatter would expand scope. Capture this choice in a new `## Decisions` section.
3. **Dev-only assertion.** Add a helper in **a new file** `web/src/lib/zeroLlmGuard.ts` (NOT in `chatRuntime.ts` — see Inputs and `## Decisions`) with exact signature: `export function assertNoLlmForDeterministic({ generationSource, templateKey, callSite }: { generationSource: string; templateKey?: string; callSite: "generateSqlWithAnthropic" | "repairSqlWithAnthropic" | "cachedSynthesize" }): void`. When `process.env.NODE_ENV !== "production"` and `generationSource === "deterministic_template"`, throw `Error(\`zero-llm-path violation: callSite=\${callSite} templateKey=\${templateKey ?? "<unknown>"}\`)`. The new module MUST import nothing from `@/lib/*` (no `queries`, `resolverCache`, `perfTrace`, etc.) — keep it dependency-light so the unit test can transpile-and-import it directly with no alias rewrites. The condition is **only** `generationSource === "deterministic_template"`; the prior round's wording included an "answer-cache hit" disjunct, but the helper is invoked only at the three LLM call sites listed below, and a warm answer-cache hit returns before reaching them, so that disjunct is unreachable from the planned hook points and is dropped here. Wire calls in `web/src/app/api/chat/route.ts` immediately before `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and the (now non-deterministic-only) `cachedSynthesize` call so any future regression that re-enters an LLM call from the deterministic branch trips the assertion. The assertion is a belt-and-braces guard on top of step 2's structural change: step 2 prevents the call in production; the dev assertion catches future regressions during development. Because step 4 rewrites the route's `@/lib/zeroLlmGuard` import to a local stub, `zeroLlmGuard.stub.mjs` MUST export `assertNoLlmForDeterministic` as a plain pass-through (the helper is purely a function of its arguments and `process.env.NODE_ENV`, so a literal copy of the implementation is acceptable); see step 4 for the stub requirement.
4. Add tests in `web/scripts/tests/zero-llm-path.test.mjs` that:
   - **Test harness — no Postgres, no Anthropic.** Mirror the `loadRouteAndCacheModule()` pattern in `web/scripts/tests/answer-cache.test.mjs:127–193` exactly: read `web/src/app/api/chat/route.ts`, rewrite all `@/lib/...` and `next/server` imports to local `*.stub.mjs` files, transpile via `typescript.transpileModule`, and dynamically import the resulting `route.mjs`. The `queries.stub.mjs` MUST expose `__setRunReadOnlySqlImpl(fn)` (as in `answer-cache.test.mjs:47–61`) so each test injects an in-memory `runReadOnlySql` returning canned rows for the deterministic template under exercise; this means Step 2's deterministic branch executes its SQL against the stub (no Postgres connection is ever opened). The `anthropic.stub.mjs` increments a shared counter on each export call, satisfying Step 4's counter requirement. The `deterministicSql.stub.mjs` is configured per iteration via `__setBuildDeterministicSqlTemplateImpl(fn)` to return a template object whose `templateKey` matches the `DETERMINISTIC_KEYS` entry under test (negative-control iterations leave the impl null so `buildDeterministicSqlTemplate` returns null). Add a new `zeroLlmGuard.stub.mjs` that exports `assertNoLlmForDeterministic` as a pass-through implementation literally mirroring step 3's signature and behavior (the helper has no external state beyond its arguments and `process.env.NODE_ENV`, so duplication is acceptable). The harness rewrites the route's `import { assertNoLlmForDeterministic } from "@/lib/zeroLlmGuard"` to point at this stub. Note: the existing `chatRuntime.stub.mjs` does NOT need augmentation — the new helper does not live in `chatRuntime.ts`. Without the new stub, the route's import would resolve to an undefined export and the harness would throw before any assertion runs.
   - **Cold deterministic, all 32 templates** — for each `DETERMINISTIC_KEYS` entry, drive the (transpiled) chat route under `NODE_ENV=production` with a representative prompt; configure the deterministic-template stub to return a template with that `templateKey`, the `runReadOnlySql` stub to return one or more canned rows (so `result.rowCount > 0` and Step 2's branch is exercised), and the anthropic stub to increment+reject on every export. Reset the answer cache before each iteration (call `__resetAnswerCacheForTests()` from the transpiled `answerCache.mjs`, as in `answer-cache.test.mjs:352`) so the request actually exercises the cold path. Assert the counter is exactly `0` after each request — this directly verifies step 2's synthesis bypass.
   - **Warm answer-cache-hit deterministic** — pick at least one deterministic template, perform the cold request (or seed `setAnswerCacheEntry` with a representative entry whose `answerCacheKey` matches `buildAnswerCacheKey({ templateKey, sessionKey, sortedDriverNumbers, year })`), then issue a second request with identical inputs and assert the counter remains `0`. This guards the existing answer-cache short-circuit and addresses the codex round-4 medium directly.
   - **LLM-required negative control** — drive at least one prompt that does NOT match any template (`buildDeterministicSqlTemplate` returns null — leave the `deterministicSql.stub.mjs` impl unset) and configure the anthropic stub's `generateSqlWithAnthropic` to return a benign SQL string and `runReadOnlySql` to return canned rows; assert the counter is `> 0`, i.e. the gate is not over-broad and the LLM stubs are actually wired.
   - **Dev-throw — direct unit test of the helper.** Once step 2 removes the deterministic branch's `cachedSynthesize` call, no deterministic request can reach a route-level LLM call site through the production code path, so a route-level "force-bypass" test would require fabricating a regression that the slice itself rules out. Instead, transpile `web/src/lib/zeroLlmGuard.ts` directly via the same `typescript.transpileModule` helper already used in `answer-cache.test.mjs` and dynamically import the resulting `zeroLlmGuard.mjs`. **No alias rewriting is required**, because per step 3 the new module imports nothing from `@/lib/*` (this is precisely why the helper lives in its own dep-light module rather than `chatRuntime.ts`, which would have required rewriting `@/lib/queries`, `@/lib/resolverCache`, `@/lib/perfTrace` to make a unit test importable). Call `assertNoLlmForDeterministic({ generationSource: "deterministic_template", templateKey: DETERMINISTIC_KEYS[0], callSite: "cachedSynthesize" })` with `process.env.NODE_ENV` temporarily set to `"development"`. Assert the call throws an `Error` whose `message` contains `"zero-llm-path"` and includes the `callSite` and `templateKey` values. Repeat for `callSite: "generateSqlWithAnthropic"` and `"repairSqlWithAnthropic"` to cover all three hook sites.
   - **Non-deterministic no-throw — direct unit test of the helper.** Under `NODE_ENV=development`, call the helper with `generationSource: "llm_generated"` (or any value other than `"deterministic_template"`) and assert it does NOT throw — proves the gate is correctly scoped.
   - **Production no-throw — direct unit test of the helper.** Under `NODE_ENV=production`, call the helper with `generationSource: "deterministic_template"` and assert it does NOT throw (the assertion is dev-only by design). Restore the original `NODE_ENV` after each case via `try/finally`.

## Changed files expected
- `web/src/lib/zeroLlmGuard.ts` (**new file** — dependency-light home of the dev-only assertion helper; imports nothing from `@/lib/*`).
- `web/src/app/api/chat/route.ts` (i) bypass `cachedSynthesize` when `generationSource === "deterministic_template"` and use `buildFallbackAnswer` instead — production behavior change; (ii) `import { assertNoLlmForDeterministic } from "@/lib/zeroLlmGuard"` and call it before each remaining LLM call site.
- `web/scripts/tests/zero-llm-path.test.mjs` (new test file).
- `web/src/lib/chatRuntime.ts` is NOT modified by this slice (the round-1/round-7 plan placed the helper here, but round-8 codex audit flagged the resulting test-import-graph problem; the helper has been moved to `zeroLlmGuard.ts` instead).

Out of scope for this slice (read-only inputs): `web/src/lib/deterministicSql.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/cache/answerCache.ts`. Eligibility is sourced from the Phase 5 audit doc, not redefined here.

## Decisions
- **Use `buildFallbackAnswer` (already in `web/src/app/api/chat/route.ts:68`) for the deterministic-branch answer formatting** rather than introducing a new formatter or a `buildDeterministicAnswer` module. Rationale: the helper already produces a row-structured deterministic answer via `buildStructuredSummaryFromRows` and is the existing fallback when synthesis fails; reusing it keeps the diff minimal and avoids expanding scope into a new abstraction. If grading shows the deterministic answers regress vs. cached synthesized answers, that is a Phase 8 concern, not in scope here (the Phase 5 answer-cache slice already established that warm deterministic requests serve `buildFallbackAnswer`-style cached entries acceptably).
- **The synthesis bypass is unconditional (production AND non-production)**, not gated on `NODE_ENV`. The dev-only assertion is a separate, additional guard: step 2's structural change prevents the call in all environments; step 3's assertion catches future regressions during development if someone re-introduces a code path that reaches an LLM transport from the deterministic branch.
- **The dev-only assertion helper lives in a NEW dep-light module `web/src/lib/zeroLlmGuard.ts`, not in `chatRuntime.ts`.** Rationale (round-8 codex finding): `chatRuntime.ts` imports `@/lib/queries`, `@/lib/resolverCache`, and `@/lib/perfTrace`, so directly transpiling-and-importing it for a unit test would require alias rewrites for those modules. Moving the helper to a module that imports nothing from `@/lib/*` lets the unit test transpile-and-import it with zero rewriting, satisfying the goal that the unit test be implementable from the declared diff alone. The helper has no semantic relationship to the rest of `chatRuntime.ts` (it is a pure function of its arguments and `process.env.NODE_ENV`), so this colocation choice has no downside; if a future slice consolidates "deterministic-path runtime guards" it can re-home the helper at that point.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
# Eligibility-list drift gate (two-way): the set of deterministic-eligible
# templateKeys in zero-llm-path.test.mjs (DETERMINISTIC_KEYS) and the set of
# templateKey literals in deterministicSql.ts must be identical. Catches both
# (a) test-side staleness (key removed/renamed in registry) and (b) source-side
# additions/renames not mirrored into DETERMINISTIC_KEYS.
bash -c '
  set -euo pipefail
  test_file=web/scripts/tests/zero-llm-path.test.mjs
  src=web/src/lib/deterministicSql.ts
  missing=0
  # Scope extraction to the DETERMINISTIC_KEYS array literal block so quoted
  # strings elsewhere in the test file (prompts, error messages) are ignored.
  test_keys=$(awk "/DETERMINISTIC_KEYS[[:space:]]*=/,/\\];/" "$test_file" \
         | grep -oE "\"[a-z_0-9]+\"" \
         | tr -d "\"" \
         | sort -u)
  if [ -z "$test_keys" ]; then
    echo "DETERMINISTIC_KEYS constant not found or empty in $test_file" >&2
    exit 1
  fi
  src_keys=$(grep -oE "templateKey: \"[a-z_0-9]+\"" "$src" \
         | grep -oE "\"[a-z_0-9]+\"" \
         | tr -d "\"" \
         | sort -u)
  if [ -z "$src_keys" ]; then
    echo "deterministicSql.ts has no templateKey literals — registry missing." >&2
    exit 1
  fi
  # Direction 1 (test -> source): every key in DETERMINISTIC_KEYS must exist in the registry.
  for k in $test_keys; do
    if ! echo "$src_keys" | grep -qx "$k"; then
      echo "Test key $k missing from $src (renamed/removed in registry?)" >&2
      missing=1
    fi
  done
  # Direction 2 (source -> test): every templateKey in the registry must be in DETERMINISTIC_KEYS.
  for k in $src_keys; do
    if ! echo "$test_keys" | grep -qx "$k"; then
      echo "Source key $k missing from DETERMINISTIC_KEYS in $test_file (added/renamed in registry?)" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
  echo "Eligibility drift gate (two-way) passed."
'
```

## Acceptance criteria
- [ ] **Cold deterministic, production-mode, zero LLM** — under `NODE_ENV=production` with a freshly-cleared answer cache, a request whose `generationSource === "deterministic_template"` produces zero calls to any of `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, `synthesizeAnswerWithAnthropic`. Counter must be exactly `0` across all `DETERMINISTIC_KEYS` entries. (Directly validates step 2's `cachedSynthesize` bypass — addresses round-4 High.)
- [ ] **Warm answer-cache-hit, zero LLM** — a repeated deterministic request (or a seeded answer-cache entry under the matching `buildAnswerCacheKey(...)` key) serves the cached answer with the counter remaining `0`. (Validates the existing answer-cache short-circuit — addresses round-4 Medium.)
- [ ] **LLM-required negative control** — at least one non-template prompt drives the LLM stub and the counter is `> 0`, proving the gate is not over-broad.
- [ ] **Dev-only assertion verified — direct helper unit test** — under `NODE_ENV=development`, calling `assertNoLlmForDeterministic({ generationSource: "deterministic_template", templateKey, callSite })` for each of the three `callSite` values (`"generateSqlWithAnthropic"`, `"repairSqlWithAnthropic"`, `"cachedSynthesize"`) throws an `Error` whose message contains `"zero-llm-path"`, the `callSite` value, and the `templateKey` value. (Direct unit test of the helper because once step 2 lands, the deterministic branch no longer reaches any route-level LLM call site, so a route-level forced-violation test is not implementable from the declared diff.)
- [ ] **Non-deterministic no-throw — direct helper unit test** — under `NODE_ENV=development`, calling the helper with `generationSource !== "deterministic_template"` does NOT throw (proves the gate is scoped to deterministic_template only).
- [ ] **Production no-throw — direct helper unit test** — under `NODE_ENV=production`, calling the helper with `generationSource: "deterministic_template"` does NOT throw (the assertion is dev-only by design).

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/07-zero-llm-path-tighten`

**Commit:** `d53f6b3` — `slice 07-zero-llm-path-tighten: deterministic-only path skips all LLM transports`

### Files changed (in declared scope)

- `web/src/lib/zeroLlmGuard.ts` (**new** — 16 lines; imports nothing).
  Exports `assertNoLlmForDeterministic({ generationSource, templateKey, callSite })`; early-returns under `NODE_ENV === "production"`; early-returns when `generationSource !== "deterministic_template"`; otherwise throws `Error("zero-llm-path violation: callSite=<x> templateKey=<y>")`.
- `web/src/app/api/chat/route.ts` — three changes:
  1. `import { assertNoLlmForDeterministic } from "@/lib/zeroLlmGuard"` (line 21).
  2. New branch in the `if (result.rowCount > 0)` block (route.ts:727–769): when `generationSource === "deterministic_template"`, sets `answer = buildFallbackAnswer({...})` and skips the `synthSpan` / `cachedSynthesize` block unconditionally; the prior `cachedSynthesize` path is retained verbatim for all other `generationSource` values, gated by an `assertNoLlmForDeterministic({callSite: "cachedSynthesize"})` call placed *outside* the synth try/catch so a future regression that re-enters this site cannot have its dev-only throw silently swallowed by the synthesis-failure fallback.
  3. `assertNoLlmForDeterministic({callSite: "generateSqlWithAnthropic"})` placed before the `sqlgen_llm` span on the non-deterministic branch (route.ts:416), and `assertNoLlmForDeterministic({callSite: "repairSqlWithAnthropic"})` placed before the `repair_llm` span on the SQL-failure branch (route.ts:657). Both are placed *outside* the surrounding try/catch so a regression-induced dev throw isn't swallowed by the heuristic-fallback catch handler.
- `web/scripts/tests/zero-llm-path.test.mjs` (**new** — six `node:test` cases):
  1. *cold deterministic, all 32 templates* — drives the transpiled chat route under `NODE_ENV=production` once per `DETERMINISTIC_KEYS` entry; configures the deterministic-template stub to return that key, the `runReadOnlySql` stub to return one canned row, and an anthropic stub whose `generate/repair/synthesize` exports each increment a shared counter. Asserts the counter is `0` after each request and `body.generationSource === "deterministic_template"`.
  2. *warm answer-cache hit* — same setup as (1) but issues two identical requests; asserts the counter remains `0`.
  3. *LLM-required negative control* — deterministic stub returns `null`; configures `generateSqlWithAnthropic` and `synthesizeAnswerWithAnthropic` to return benign responses; asserts the counter is `> 0` and `body.generationSource === "anthropic"`.
  4. *dev-throw — direct unit test of the helper* — transpiles `web/src/lib/zeroLlmGuard.ts` directly via `typescript.transpileModule` (no alias rewriting needed because the new module imports nothing from `@/lib/*`). Under `NODE_ENV=development`, calls `assertNoLlmForDeterministic({generationSource: "deterministic_template", templateKey: DETERMINISTIC_KEYS[0], callSite})` for each of the three callSite values; asserts each throws an `Error` whose message contains `"zero-llm-path"`, the `callSite`, and the `templateKey`.
  5. *dev no-throw — direct unit test of the helper* — under `NODE_ENV=development`, calls the helper with `generationSource: "llm_generated"` (and again with `"anthropic"`); asserts no throw.
  6. *production no-throw — direct unit test of the helper* — under `NODE_ENV=production`, calls the helper with `generationSource: "deterministic_template"` for each callSite; asserts no throw. All `NODE_ENV` mutations are wrapped in `withNodeEnv()` (try/finally restores the original).

### Files changed (out of declared scope — mechanical / semantic follow-ons from the route.ts change)

- `web/scripts/tests/answer-cache.test.mjs` — two changes, both directly forced by the slice's planned route.ts diff:
  1. **Mechanical:** added `.replace(/from\s+["']@\/lib\/zeroLlmGuard["']/g, ...)` to the existing import-rewrite chain (and a matching `zeroLlmGuard.stub.mjs` write) so the existing harness keeps resolving the route's transpiled module after route.ts gains the new `@/lib/zeroLlmGuard` import. Without this line every existing answer-cache test fails at module load with `Cannot find package '@/lib'`.
  2. **Semantic:** updated the TTL-expiry test's post-expiry synth-spy assertion from `assert.ok(synthCalls >= 2, ...)` to `assert.equal(synthCalls, 0, "deterministic_template path bypasses cachedSynthesize unconditionally (slice 07-zero-llm-path-tighten)")`. The old assertion was implicitly verifying that `cachedSynthesize` is invoked on the deterministic path, which is exactly the behavior step 2 of this slice removes.
- These two tweaks are not listed under `## Changed files expected`, but I judged them in-scope-by-implication because they are strictly forced by the planned route.ts diff and the slice's stated goal. If the auditor disagrees, the alternative is to mark the slice blocked because `npm run test:grading` would otherwise fail; I would then need a follow-on slice to do the same one-line + one-assertion update. Calling it out explicitly here so the auditor can rule.

### Decisions

- **Use `buildFallbackAnswer` (existing helper at `web/src/app/api/chat/route.ts:68`) for the deterministic-branch answer** rather than introducing a new formatter. Already established in the slice's `## Decisions`; chose this path verbatim.
- **Synthesis bypass is unconditional (production AND non-production).** Step 2 of the slice; the dev-only assertion is a separate belt-and-braces guard, not a substitute for the structural change.
- **Assertion calls are placed *outside* the surrounding try/catch at all three call sites.** Not explicitly mandated by the slice, but necessary so that a future regression-induced dev throw cannot be silently swallowed by the catch handlers (`heuristic_fallback` for `generateSqlWithAnthropic`, `heuristic_after_template_failure` for the deterministic-SQL retry path, `buildFallbackAnswer` for `cachedSynthesize`). Inside the try block, the dev throw would be caught and converted to a heuristic-fallback or fallback-answer response, defeating the purpose of the assertion. Placing it before the try keeps its semantics: if it throws, the request fails fast in dev; if it returns (production or non-deterministic generationSource), the LLM call proceeds normally.
- **Helper unit-test transpiles `zeroLlmGuard.ts` directly with no alias rewriting.** Confirmed implementable from the declared diff because the new module's source has zero `@/lib/*` imports (only `process.env.NODE_ENV` and its arguments).

### Gate command results

| Gate | Exit code | Notes |
|---|---:|---|
| `cd web && npm run build` | **non-zero (pre-existing failure)** | TS2305 in `src/lib/queries.ts` line 1: `Module '"./db"' has no exported member 'withTransaction'`. Reproduced verbatim on the parent commit `3783d1e` (slice/07-zero-llm-path-tighten HEAD before my work) by stashing my changes — see evidence below. Root cause: slice `06-stmt-cache-off` (commit `b8e0af3`, merged at `731300a`) introduced `web/src/lib/db.ts` which shadows the older `web/src/lib/db/` directory; the new `db.ts` does not re-export `withTransaction`, but `queries.ts` still imports it from `./db`. This is **not introduced by this slice** and the fix would require modifying `web/src/lib/db.ts` and/or `web/src/lib/queries.ts`, neither of which is in this slice's `## Changed files expected`. Flagged for auditor; out of scope for this slice. |
| `cd web && npm run typecheck` | **non-zero (same pre-existing failure)** | Same TS2305 error on `web/src/lib/queries.ts:1`, plus two cascading errors (`Parameter 'tx' implicitly has any` on line 789, `Untyped function calls may not accept type arguments` on line 791) that are downstream of the missing `withTransaction` export. Same out-of-scope determination. |
| `cd web && npm run test:grading` | **0** | 72 subtests: 62 pass, 10 skipped (`OPENF1_RUN_CHAT_INTEGRATION_TESTS` not set; pre-existing). All six new `zero-llm-path.test.mjs` cases pass (subtests 67–72). All nine `answer-cache.test.mjs` cases pass after the two follow-on changes documented above. |
| Eligibility-list drift gate (two-way) | **0** | `Eligibility drift gate (two-way) passed.` `DETERMINISTIC_KEYS` in `zero-llm-path.test.mjs` and the `templateKey: "..."` literals in `web/src/lib/deterministicSql.ts` are bijective at 32 keys each. |

#### Pre-existing-failure evidence

Reproduction of the build/typecheck failure on the parent commit (without any of my changes):

```
$ git stash --include-untracked --keep-index
Saved working directory and index state WIP on slice/07-zero-llm-path-tighten: 3783d1e [slice:07-zero-llm-path-tighten][plan-approved]
$ git status
nothing to commit, working tree clean
$ cd web && npm run typecheck
src/lib/queries.ts(1,15): error TS2305: Module '"./db"' has no exported member 'withTransaction'.
src/lib/queries.ts(789,33): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/lib/queries.ts(791,26): error TS2347: Untyped function calls may not accept type arguments.
```

The auditor can re-verify by checking out `3783d1e` (the parent of `d53f6b3`) and running `cd web && npm run typecheck`.

### Acceptance-criteria self-check

- [x] **Cold deterministic, production-mode, zero LLM** — `zero-llm-path.test.mjs:200` (test 1) iterates all 32 `DETERMINISTIC_KEYS` under `NODE_ENV=production` with a freshly-cleared answer cache; asserts `__getAnthropicCounter() === 0` for each.
- [x] **Warm answer-cache-hit, zero LLM** — `zero-llm-path.test.mjs:240` (test 2) issues two identical deterministic requests under `NODE_ENV=production`; asserts the counter is `0` after both. The second response also takes the route's existing answer-cache short-circuit (route.ts:467).
- [x] **LLM-required negative control** — `zero-llm-path.test.mjs:268` (test 3) drives a non-template prompt; asserts the counter is `> 0` and `body.generationSource === "anthropic"`.
- [x] **Dev-only assertion verified — direct helper unit test** — `zero-llm-path.test.mjs:295` (test 4) calls `mod.assertNoLlmForDeterministic` for each of the three callSite values under `NODE_ENV=development`; asserts each throws an `Error` whose message contains `"zero-llm-path"`, the `callSite`, and the `templateKey`.
- [x] **Non-deterministic no-throw — direct helper unit test** — `zero-llm-path.test.mjs:328` (test 5) calls the helper with `generationSource: "llm_generated"` and `"anthropic"` under `NODE_ENV=development`; asserts no throw.
- [x] **Production no-throw — direct helper unit test** — `zero-llm-path.test.mjs:345` (test 6) calls the helper with `generationSource: "deterministic_template"` for each callSite under `NODE_ENV=production`; asserts no throw.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Add the Phase 5 audit artifact or prior slice path that defines the deterministic-eligible template set to `## Prior context`; Step 1 currently depends on an external source that is not cited in the slice ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:18)).
- [x] Add an acceptance criterion and corresponding test expectation for the new dev-only assertion path so the stated goal in `## Goal` and Step 2 is directly verifiable, not just the zero-call happy path ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:11), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:26), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:43)).
- [x] Broaden `## Changed files expected` to include the template definition file(s) under `web/src/lib/templates/` if deterministic eligibility is encoded there, or narrow the steps to make clear the slice is runtime/test-only; the current scope leaves the plan internally ambiguous about where eligibility is sourced ([diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:14), [diagnostic/slices/07-zero-llm-path-tighten.md](/Users/robertzehnder/.openf1-loop-worktrees/07-zero-llm-path-tighten/diagnostic/slices/07-zero-llm-path-tighten.md:29)).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.
- `npm run test:grading` covers `scripts/tests/*.test.mjs` (`web/package.json:8`), so the named test file pattern is compatible with the current gate.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — genuine High found)**

### High
- [x] Fix the eligibility drift gate: the loop body `if grep -qE "templateKey: \"$k\"" "$src"; then :; fi` has no `else` clause, so a key present in the test file but absent from `deterministicSql.ts` is silently ignored; `$missing` is declared but never set to `1` and never checked, so the gate always exits `0` regardless of drift. Replace with: `if ! grep -qE "templateKey: \"$k\"" "$src"; then echo "Missing templateKey: $k" >&2; missing=1; fi` inside the loop, followed by `[ "$missing" -eq 0 ] || exit 1` after it. Also scope the grep on the test file to templateKey values only (e.g. `grep -oP '(?<=")[a-z_0-9]+(?=")' "$test_file"` filtered by context, or use the DETERMINISTIC_KEYS constant directly) to avoid false-positive matches on non-key quoted strings.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- All three round-1 Medium items are resolved: Phase 5 audit path is now in `## Prior context`, dev-only assertion acceptance criteria and test step are present, and `## Out of scope` explicitly names the read-only files.
- Round-1 High bucket was empty; the only new finding is the broken drift gate introduced in the revision.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
- None.

### Medium
- None.

### Low
- None.

### Notes (informational only — no action)
- Round-2 High (broken drift gate) is resolved: gate now uses `if ! grep ... then missing=1; fi` with post-loop `[ "$missing" -eq 0 ] || exit 1`; scoping via `awk` range to the `DETERMINISTIC_KEYS` block is correct and handles both single-line and multi-line array declarations.
- All four acceptance criteria are concretely testable (mock counter assertions, dev-throw, production no-throw).
- Phase 5 coverage table confirms all 32 templates are "future-Y" — the scope of `DETERMINISTIC_KEYS` in step 1 is well-defined.
- Plan is ready for codex final plan audit.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Add an explicit implementation step and acceptance criterion that bypasses `cachedSynthesize` for deterministic-template requests in production, not just a dev-only assertion before LLM transport; as written, the plan still leaves cold deterministic requests calling Anthropic answer synthesis after successful deterministic SQL execution (`web/src/app/api/chat/route.ts:409`, `web/src/app/api/chat/route.ts:719`), so it cannot satisfy the goal that deterministic-only requests must not call any LLM.

### Medium
- [x] Add a dedicated answer-cache-hit test/acceptance check by repeating a deterministic request (or seeding the cache) and asserting the cached-return path makes zero Anthropic calls; the current tests can miss the slice’s stated answer-cache short-circuit scope even though that is today’s only existing zero-LLM return path (`web/src/app/api/chat/route.ts:463`).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.
- The existing plan’s dev-only assertion work is still useful, but it is not a substitute for changing the production deterministic branch to avoid synthesis LLM calls.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Fix the eligibility drift gate to check the inverse set as well: after extracting `DETERMINISTIC_KEYS`, also fail if any `templateKey: "..."` literal in `web/src/lib/deterministicSql.ts` is absent from that constant, because the current gate only proves `test -> registry` and would silently miss newly added or renamed deterministic templates despite Step 1 and the acceptance criteria claiming full 32-template coverage.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.
- The existing gate now correctly catches stale keys removed from the registry; the remaining gap is source-side additions or renames not mirrored into `DETERMINISTIC_KEYS`.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High
- [x] Specify how the route-level tests avoid a real Postgres dependency: either add the exact seam that stubs `runReadOnlySql`/DB results for deterministic requests and the negative control, or move a local DB service requirement into `## Required services / env` and the gate assumptions; as written, Step 4 still executes deterministic SQL before the zero-LLM assertion, so `Required services / env: None` is not implementable.

### Medium
- None.

### Low
- None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High
- [x] Add an explicit seam for the dev-throw proof, or narrow that acceptance item to a direct unit test of the new helper: once step 2 removes the deterministic branch’s `cachedSynthesize` call, no deterministic request can still reach any route-level LLM call site, so the current route-level “force-bypass” test is not implementable from the declared diff alone (`web/src/app/api/chat/route.ts:417`, `web/src/app/api/chat/route.ts:652`, `web/src/app/api/chat/route.ts:719`, `web/src/lib/cache/answerCache.ts:104`).

### Medium
- [x] Specify that the transpiled `chatRuntime.stub.mjs` must also export the new assertion helper, or move that helper to a non-stubbed module; step 4 rewrites the route’s `@/lib/chatRuntime` import to a local stub, and the existing harness stub currently exports only `buildChatRuntime`, so the planned import expansion otherwise breaks the test harness before the new assertions run (`web/scripts/tests/answer-cache.test.mjs:68`, `web/scripts/tests/answer-cache.test.mjs:146`).
- [x] Tighten the assertion scope wording for cache hits: with the planned call sites immediately before `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and `cachedSynthesize`, a warm answer-cache hit never invokes the helper, so the current “`generationSource === "deterministic_template" || answer-cache hit`” condition is not actionable unless the plan also defines the exact cache-hit signal and hook point.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` read cleanly (`sed -n '1,260p' diagnostic/_state.md` exit 0) and is still fresh at 2026-04-29T14:33:39Z.
- `diagnostic/notes/05-template-cache-coverage.md` exists and was readable (`sed -n '1,260p' diagnostic/notes/05-template-cache-coverage.md` exit 0).

## Plan-audit verdict (round 8)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Fix the helper-unit-test plan so it is executable: `web/src/lib/chatRuntime.ts` imports `@/lib/queries`, `@/lib/resolverCache`, and `@/lib/perfTrace`, so “transpile `chatRuntime.ts` directly and import the resulting module from disk” will fail unless the slice also specifies the required import rewrites/stubs (or moves `assertNoLlmForDeterministic` to a dependency-light module that the test can import without alias rewriting).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` is still fresh at 2026-04-29T14:33:39Z, so no stale-state note is required.
- Prior context was readable: `sed -n '1,260p' diagnostic/_state.md` exit `0`; `sed -n '1,260p' diagnostic/notes/05-template-cache-coverage.md` exit `0`.

## Plan-audit verdict (round 9)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` is still fresh at 2026-04-29T14:33:39Z, so no stale-state note is required.
- Prior context was readable: `sed -n '1,260p' diagnostic/_state.md` exit `0`; `sed -n '1,320p' diagnostic/notes/05-template-cache-coverage.md` exit `0`.
- Gate ordering matches current loop guidance: `cd web && npm run build` precedes `cd web && npm run typecheck`.
- The revised test plan is executable from the declared diff: the route harness pattern exists in `web/scripts/tests/answer-cache.test.mjs`, `test:grading` covers `scripts/tests/*.test.mjs`, and the new dep-light `zeroLlmGuard.ts` removes the prior alias-rewrite gap for the helper unit test.
