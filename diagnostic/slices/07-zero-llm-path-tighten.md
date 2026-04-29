---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T15:06:53Z
---

## Goal
Audit and tighten the deterministic-only path: questions that resolve fully via the deterministic SQL template registry must NOT call any LLM **in any environment** — neither SQL generation, nor repair, nor answer synthesis (`cachedSynthesize`). Today the cold deterministic path still invokes `cachedSynthesize` after deterministic SQL execution succeeds (`web/src/app/api/chat/route.ts:719`); only the warm answer-cache-hit short-circuit (`web/src/app/api/chat/route.ts:467`) is currently zero-LLM. This slice (a) makes the production deterministic branch bypass `cachedSynthesize` and synthesize the answer deterministically via the existing row-structured `buildFallbackAnswer` helper (`web/src/app/api/chat/route.ts:68`), (b) adds a dev-only runtime assertion (`NODE_ENV !== "production"`) that throws if a deterministic-eligible request reaches an LLM transport, and (c) locks the behavior in with tests covering cold deterministic, warm (answer-cache-hit) deterministic, an LLM-required negative control, the dev-throw, and the production no-throw.

## Inputs
- `web/src/lib/deterministicSql.ts` — canonical template registry (per Phase 5 audit; no `web/src/lib/templates/` directory exists).
- `web/src/lib/chatRuntime.ts` — runtime resolver-skip fast paths.
- `web/src/app/api/chat/route.ts` — actual LLM call sites (`generateSqlWithAnthropic`, `repairSqlWithAnthropic`, `cachedSynthesize`) and answer-cache short-circuit.
- `web/src/lib/anthropic.ts` — LLM transport (used by tests as the single mock/spy seam).
- `web/src/lib/cache/answerCache.ts` — answer-cache key / read path that defines today's only zero-LLM short-circuit.

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
3. **Dev-only assertion.** Add a helper in `web/src/lib/chatRuntime.ts` (exact signature: `export function assertNoLlmForDeterministic({ generationSource, templateKey, callSite }: { generationSource: string; templateKey?: string; callSite: "generateSqlWithAnthropic" | "repairSqlWithAnthropic" | "cachedSynthesize" }): void`) that, when `process.env.NODE_ENV !== "production"` and `generationSource === "deterministic_template"`, throws `Error(\`zero-llm-path violation: callSite=\${callSite} templateKey=\${templateKey ?? "<unknown>"}\`)`. The condition is **only** `generationSource === "deterministic_template"`; the prior round's wording included an "answer-cache hit" disjunct, but the helper is invoked only at the three LLM call sites listed below, and a warm answer-cache hit returns before reaching them, so that disjunct is unreachable from the planned hook points and is dropped here. Wire calls in `web/src/app/api/chat/route.ts` immediately before `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and the (now non-deterministic-only) `cachedSynthesize` call so any future regression that re-enters an LLM call from the deterministic branch trips the assertion. The assertion is a belt-and-braces guard on top of step 2's structural change: step 2 prevents the call in production; the dev assertion catches future regressions during development. Because step 4 rewrites the route's `@/lib/chatRuntime` import to a local stub, `chatRuntime.stub.mjs` MUST export `assertNoLlmForDeterministic` as a plain pass-through (no test seam needed — the helper is purely a function of its arguments and `process.env.NODE_ENV`); see step 4 for the stub-augmentation requirement.
4. Add tests in `web/scripts/tests/zero-llm-path.test.mjs` that:
   - **Test harness — no Postgres, no Anthropic.** Mirror the `loadRouteAndCacheModule()` pattern in `web/scripts/tests/answer-cache.test.mjs:127–193` exactly: read `web/src/app/api/chat/route.ts`, rewrite all `@/lib/...` and `next/server` imports to local `*.stub.mjs` files, transpile via `typescript.transpileModule`, and dynamically import the resulting `route.mjs`. The `queries.stub.mjs` MUST expose `__setRunReadOnlySqlImpl(fn)` (as in `answer-cache.test.mjs:47–61`) so each test injects an in-memory `runReadOnlySql` returning canned rows for the deterministic template under exercise; this means Step 2's deterministic branch executes its SQL against the stub (no Postgres connection is ever opened). The `anthropic.stub.mjs` increments a shared counter on each export call, satisfying Step 4's counter requirement. The `deterministicSql.stub.mjs` is configured per iteration via `__setBuildDeterministicSqlTemplateImpl(fn)` to return a template object whose `templateKey` matches the `DETERMINISTIC_KEYS` entry under test (negative-control iterations leave the impl null so `buildDeterministicSqlTemplate` returns null). The `chatRuntime.stub.mjs` MUST be augmented (relative to the existing `answer-cache.test.mjs` version which exports only `buildChatRuntime` plus its `__set/__reset` helpers) to also re-export the new `assertNoLlmForDeterministic` helper from the transpiled `chatRuntime.mjs`; do this by having the stub `import { assertNoLlmForDeterministic } from "./chatRuntime.real.mjs"` after the harness transpiles `web/src/lib/chatRuntime.ts` to that path, OR by inlining a pass-through implementation in the stub that mirrors step 3's signature (the helper has no external state beyond its arguments and `process.env.NODE_ENV`, so a literal copy is acceptable). Without this, the route's new `import { ..., assertNoLlmForDeterministic } from "@/lib/chatRuntime"` will resolve to an undefined export and the harness will throw before any assertion runs.
   - **Cold deterministic, all 32 templates** — for each `DETERMINISTIC_KEYS` entry, drive the (transpiled) chat route under `NODE_ENV=production` with a representative prompt; configure the deterministic-template stub to return a template with that `templateKey`, the `runReadOnlySql` stub to return one or more canned rows (so `result.rowCount > 0` and Step 2's branch is exercised), and the anthropic stub to increment+reject on every export. Reset the answer cache before each iteration (call `__resetAnswerCacheForTests()` from the transpiled `answerCache.mjs`, as in `answer-cache.test.mjs:352`) so the request actually exercises the cold path. Assert the counter is exactly `0` after each request — this directly verifies step 2's synthesis bypass.
   - **Warm answer-cache-hit deterministic** — pick at least one deterministic template, perform the cold request (or seed `setAnswerCacheEntry` with a representative entry whose `answerCacheKey` matches `buildAnswerCacheKey({ templateKey, sessionKey, sortedDriverNumbers, year })`), then issue a second request with identical inputs and assert the counter remains `0`. This guards the existing answer-cache short-circuit and addresses the codex round-4 medium directly.
   - **LLM-required negative control** — drive at least one prompt that does NOT match any template (`buildDeterministicSqlTemplate` returns null — leave the `deterministicSql.stub.mjs` impl unset) and configure the anthropic stub's `generateSqlWithAnthropic` to return a benign SQL string and `runReadOnlySql` to return canned rows; assert the counter is `> 0`, i.e. the gate is not over-broad and the LLM stubs are actually wired.
   - **Dev-throw — direct unit test of the helper.** Once step 2 removes the deterministic branch's `cachedSynthesize` call, no deterministic request can reach a route-level LLM call site through the production code path, so a route-level "force-bypass" test would require fabricating a regression that the slice itself rules out. Instead, transpile `web/src/lib/chatRuntime.ts` directly (no route stub rewrite needed for this case — import the transpiled module from disk via the same `typescript.transpileModule` helper already used in `answer-cache.test.mjs`) and call `assertNoLlmForDeterministic({ generationSource: "deterministic_template", templateKey: DETERMINISTIC_KEYS[0], callSite: "cachedSynthesize" })` with `process.env.NODE_ENV` temporarily set to `"development"`. Assert the call throws an `Error` whose `message` contains `"zero-llm-path"` and includes the `callSite` and `templateKey` values. Repeat for `callSite: "generateSqlWithAnthropic"` and `"repairSqlWithAnthropic"` to cover all three hook sites.
   - **Non-deterministic no-throw — direct unit test of the helper.** Under `NODE_ENV=development`, call the helper with `generationSource: "llm_generated"` (or any value other than `"deterministic_template"`) and assert it does NOT throw — proves the gate is correctly scoped.
   - **Production no-throw — direct unit test of the helper.** Under `NODE_ENV=production`, call the helper with `generationSource: "deterministic_template"` and assert it does NOT throw (the assertion is dev-only by design). Restore the original `NODE_ENV` after each case via `try/finally`.

## Changed files expected
- `web/src/lib/chatRuntime.ts` (dev-only assertion helper).
- `web/src/app/api/chat/route.ts` (i) bypass `cachedSynthesize` when `generationSource === "deterministic_template"` and use `buildFallbackAnswer` instead — production behavior change; (ii) call the dev-only assertion helper before each remaining LLM call site.
- `web/scripts/tests/zero-llm-path.test.mjs` (new test file).

Out of scope for this slice (read-only inputs): `web/src/lib/deterministicSql.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/cache/answerCache.ts`. Eligibility is sourced from the Phase 5 audit doc, not redefined here.

## Decisions
- **Use `buildFallbackAnswer` (already in `web/src/app/api/chat/route.ts:68`) for the deterministic-branch answer formatting** rather than introducing a new formatter or a `buildDeterministicAnswer` module. Rationale: the helper already produces a row-structured deterministic answer via `buildStructuredSummaryFromRows` and is the existing fallback when synthesis fails; reusing it keeps the diff minimal and avoids expanding scope into a new abstraction. If grading shows the deterministic answers regress vs. cached synthesized answers, that is a Phase 8 concern, not in scope here (the Phase 5 answer-cache slice already established that warm deterministic requests serve `buildFallbackAnswer`-style cached entries acceptably).
- **The synthesis bypass is unconditional (production AND non-production)**, not gated on `NODE_ENV`. The dev-only assertion is a separate, additional guard: step 2's structural change prevents the call in all environments; step 3's assertion catches future regressions during development if someone re-introduces a code path that reaches an LLM transport from the deterministic branch.

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
(filled by Claude)

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
- [ ] Fix the helper-unit-test plan so it is executable: `web/src/lib/chatRuntime.ts` imports `@/lib/queries`, `@/lib/resolverCache`, and `@/lib/perfTrace`, so “transpile `chatRuntime.ts` directly and import the resulting module from disk” will fail unless the slice also specifies the required import rewrites/stubs (or moves `assertNoLlmForDeterministic` to a dependency-light module that the test can import without alias rewriting).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` is still fresh at 2026-04-29T14:33:39Z, so no stale-state note is required.
- Prior context was readable: `sed -n '1,260p' diagnostic/_state.md` exit `0`; `sed -n '1,260p' diagnostic/notes/05-template-cache-coverage.md` exit `0`.
