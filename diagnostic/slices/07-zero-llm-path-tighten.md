---
slice_id: 07-zero-llm-path-tighten
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T20:05:00Z
---

## Goal
Audit and tighten the deterministic-only path: questions that resolve fully via the deterministic SQL template registry + answer-cache short-circuit must NOT call any LLM (neither SQL generation, nor repair, nor answer synthesis). Add an assertion that throws in dev (`NODE_ENV !== "production"`) if a deterministic-eligible request reaches the LLM path, and lock the behavior in with tests.

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
2. Add a dev-only runtime assertion at each LLM call site reachable from a deterministic-eligible request. Implementation: a helper in `web/src/lib/chatRuntime.ts` (e.g. `assertNoLlmForDeterministic({ generationSource, templateKey })`) that throws `Error("zero-llm-path violation: ...")` when `process.env.NODE_ENV !== "production"` and `(generationSource === "deterministic_template" || answer-cache hit) && an LLM transport is about to be invoked`. Wire calls in `web/src/app/api/chat/route.ts` immediately before `generateSqlWithAnthropic`, `repairSqlWithAnthropic`, and the synthesis path so any future regression that re-enters an LLM call from the deterministic branch trips the assertion.
3. Add tests in `web/scripts/tests/zero-llm-path.test.mjs` that:
   - For each deterministic-eligible template (from step 1), drive the chat route with a representative prompt and a stubbed `web/src/lib/anthropic.ts` whose three exports (`generateSqlWithAnthropic`, `repairSqlWithAnthropic`, `synthesizeAnswerWithAnthropic`) increment a counter and reject. Assert the counter is `0`.
   - Drive at least one LLM-required prompt (no template match) and assert the counter is `> 0`, i.e. the gate is not over-broad.
   - Drive one deterministic-eligible prompt with `NODE_ENV=development` and a deliberately wired LLM stub return to confirm the dev assertion throws (proves the assertion exists, not just that the happy path stays quiet).

## Changed files expected
- `web/src/lib/chatRuntime.ts` (assertion helper).
- `web/src/app/api/chat/route.ts` (call the helper before each LLM call site; no behavior change in production).
- `web/scripts/tests/zero-llm-path.test.mjs` (new test file).

Out of scope for this slice (read-only inputs): `web/src/lib/deterministicSql.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/cache/answerCache.ts`. Eligibility is sourced from the Phase 5 audit doc, not redefined here.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
# Eligibility-list drift gate: every deterministic-eligible templateKey enumerated
# in zero-llm-path.test.mjs (DETERMINISTIC_KEYS constant) must exist in
# deterministicSql.ts (catches renames in either direction).
bash -c '
  set -euo pipefail
  test_file=web/scripts/tests/zero-llm-path.test.mjs
  src=web/src/lib/deterministicSql.ts
  missing=0
  # Scope extraction to the DETERMINISTIC_KEYS array literal block so quoted
  # strings elsewhere in the test file (prompts, error messages) are ignored.
  keys=$(awk "/DETERMINISTIC_KEYS[[:space:]]*=/,/\\];/" "$test_file" \
         | grep -oE "\"[a-z_0-9]+\"" \
         | tr -d "\"" \
         | sort -u)
  if [ -z "$keys" ]; then
    echo "DETERMINISTIC_KEYS constant not found or empty in $test_file" >&2
    exit 1
  fi
  for k in $keys; do
    if ! grep -qE "templateKey: \"$k\"" "$src"; then
      echo "Missing templateKey: $k in $src" >&2
      missing=1
    fi
  done
  # Inverse: the registry must define at least one templateKey literal.
  if ! grep -qE "templateKey: \"[a-z_0-9]+\"" "$src"; then
    echo "deterministicSql.ts has no templateKey literals — registry missing." >&2
    exit 1
  fi
  [ "$missing" -eq 0 ] || exit 1
  echo "Eligibility drift gate passed."
'
```

## Acceptance criteria
- [ ] Deterministic test cases produce zero LLM API calls (assert via mock/spy on `web/src/lib/anthropic.ts` exports). Counter must be exactly `0` across all deterministic-eligible templates listed in step 1.
- [ ] Existing LLM-required cases still work — at least one non-template prompt drives the LLM stub and the counter is `> 0`.
- [ ] Dev-only assertion is directly verified: a test sets `NODE_ENV=development`, forces a deterministic-eligible path to invoke the LLM stub, and confirms the runtime throws an error containing `"zero-llm-path"`.
- [ ] Production guard: the same forced violation under `NODE_ENV=production` does NOT throw (the assertion is dev-only, by design — verified by an additional test case).

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
- [ ] Add an explicit implementation step and acceptance criterion that bypasses `cachedSynthesize` for deterministic-template requests in production, not just a dev-only assertion before LLM transport; as written, the plan still leaves cold deterministic requests calling Anthropic answer synthesis after successful deterministic SQL execution (`web/src/app/api/chat/route.ts:409`, `web/src/app/api/chat/route.ts:719`), so it cannot satisfy the goal that deterministic-only requests must not call any LLM.

### Medium
- [ ] Add a dedicated answer-cache-hit test/acceptance check by repeating a deterministic request (or seeding the cache) and asserting the cached-return path makes zero Anthropic calls; the current tests can miss the slice’s stated answer-cache short-circuit scope even though that is today’s only existing zero-LLM return path (`web/src/app/api/chat/route.ts:463`).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T14:33:39Z, so no stale-state note is required.
- The existing plan’s dev-only assertion work is still useful, but it is not a substitute for changing the production deterministic branch to avoid synthesis LLM calls.
