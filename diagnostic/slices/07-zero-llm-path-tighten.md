---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T15:30:00Z
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
None at author time. Tests must work with `NODE_ENV=test` and without an `ANTHROPIC_API_KEY`; the assertion-trip test uses `NODE_ENV=development` to exercise the throw.

## Steps
1. Enumerate deterministic-eligible templates from `diagnostic/notes/05-template-cache-coverage.md` (the 32-row coverage table) and cross-check against the `templateKey: "..."` literals in `web/src/lib/deterministicSql.ts`. Codify this list in the test file as a single exported constant **named exactly `DETERMINISTIC_KEYS`** (e.g. `export const DETERMINISTIC_KEYS = ["...", ...];`) so the drift gate (see `## Gate commands`) can scope its extraction to that block and so future drift is caught.
2. **Production change — bypass `cachedSynthesize` for deterministic-template requests.** In `web/src/app/api/chat/route.ts`, replace the unconditional `cachedSynthesize` call inside the `if (result.rowCount > 0) { ... }` block (around `web/src/app/api/chat/route.ts:716`–`746`) with a branch:
   - When `generationSource === "deterministic_template"`, set `answer = buildFallbackAnswer({ question: message, rowCount: result.rowCount, rows: result.rows, caveatText })` and leave `answerReasoning` undefined; do NOT enter the `synthSpan`/`cachedSynthesize` block. This is unconditional (production AND non-production) — the goal is no LLM call, ever, on the deterministic branch.
   - For all other `generationSource` values, retain today's `cachedSynthesize` path unchanged.
   - Rationale (reuse `buildFallbackAnswer`): the helper already exists in the same file (`web/src/app/api/chat/route.ts:68`) and produces a row-structured deterministic answer via `buildStructuredSummaryFromRows`; introducing a new formatter would expand scope. Capture this choice in a new `## Decisions` section.
3. **Dev-only assertion.** Add a helper in `web/src/lib/chatRuntime.ts` (e.g. `assertNoLlmForDeterministic({ generationSource, templateKey, callSite })`) that throws `Error("zero-llm-path violation: ...")` when `process.env.NODE_ENV !== "production"` and `(generationSource === "deterministic_template" || answer-cache hit) && an LLM transport is about to be invoked`. Wire calls in `web/src/app/api/chat/route.ts` immediately before `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and the (now non-deterministic-only) `cachedSynthesize` call so any future regression that re-enters an LLM call from the deterministic branch trips the assertion. The assertion is a belt-and-braces guard on top of step 2's structural change: step 2 prevents the call in production; the dev assertion catches future regressions during development.
4. Add tests in `web/scripts/tests/zero-llm-path.test.mjs` that:
   - **Cold deterministic, all 32 templates** — for each `DETERMINISTIC_KEYS` entry, drive the chat route under `NODE_ENV=production` with a representative prompt and a stubbed `web/src/lib/anthropic.ts` whose three exports (`generateSqlWithAnthropic`, `repairSqlWithAnthropic`, `synthesizeAnswerWithAnthropic`) each increment a shared counter and reject. Reset the answer cache before each iteration (call `clearAnswerCache()` or equivalent reset) so the request actually exercises the cold path. Assert the counter is exactly `0` after each request — this directly verifies step 2's synthesis bypass.
   - **Warm answer-cache-hit deterministic** — pick at least one deterministic template, perform the cold request (or seed `setAnswerCacheEntry` with a representative entry whose `answerCacheKey` matches `buildAnswerCacheKey({ templateKey, sessionKey, sortedDriverNumbers, year })`), then issue a second request with identical inputs and assert the counter remains `0`. This guards the existing answer-cache short-circuit and addresses the codex round-4 medium directly.
   - **LLM-required negative control** — drive at least one prompt that does NOT match any template (`buildDeterministicSqlTemplate` returns null) and assert the counter is `> 0`, i.e. the gate is not over-broad and the LLM stubs are actually wired.
   - **Dev-throw** — drive one deterministic-eligible prompt with `NODE_ENV=development` and force-bypass the production synthesis-skip (e.g. by wiring the assertion call site to invoke an LLM stub or by injecting a regression where step 2's branch is short-circuited via a test seam) to confirm the runtime throws an error containing `"zero-llm-path"`.
   - **Production no-throw** — under `NODE_ENV=production`, attempt the same forced-violation scenario as the dev-throw test and assert that no error is thrown (the assertion is dev-only by design).

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
- [ ] **Dev-only assertion verified** — a test sets `NODE_ENV=development`, forces a deterministic-eligible path to reach an LLM stub (via a test seam that bypasses step 2's branch), and confirms the runtime throws an error containing `"zero-llm-path"`.
- [ ] **Production no-throw** — the same forced violation under `NODE_ENV=production` does NOT throw (the assertion is dev-only by design).

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
