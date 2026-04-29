---
slice_id: 07-skip-repair-on-deterministic
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29T17:08:11Z
---

## Goal
Skip the LLM-based JSON-repair pass when the upstream output is already valid JSON (parsed cleanly). Avoids a wasteful repair call for the common case.

## Inputs
- `web/src/lib/chatRuntime.ts` (repair logic)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. In `web/src/lib/chatRuntime.ts`, locate the repair-call site (the path that invokes the LLM-based JSON repair on the upstream output) and wrap it with a `JSON.parse(...)` try/catch on the upstream string. On successful parse, return the parsed value directly and skip the repair call entirely. On `SyntaxError`, fall through to the existing repair path.
2. Expose an injectable seam so tests can observe whether the repair path was invoked. Either (a) accept an optional `repairFn` parameter on the relevant exported function (defaulting to the real repair implementation), or (b) export a small `__testHooks` object with a counter / spy that the implementation increments when repair runs. The seam must be reachable from a Node `--test` test file without bundling Next.
3. Add `web/scripts/tests/skip-repair.test.mjs` with two `node:test` cases:
   - `valid JSON skips repair` — feed a string of valid JSON, assert the spy/counter was NOT called and the returned value equals `JSON.parse(input)`.
   - `malformed JSON triggers repair` — feed a malformed JSON string, assert the spy/counter WAS called exactly once.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/scripts/tests/skip-repair.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

Note: `npm run test:grading` resolves to `node --test scripts/tests/*.test.mjs` (see `web/package.json`), so the new `web/scripts/tests/skip-repair.test.mjs` file is picked up automatically by that gate — no script wiring is required, but the gate is only observable if the test file is present and both cases below execute.

## Acceptance criteria
- [ ] `npm run test:grading` reports `skip-repair.test.mjs > valid JSON skips repair` as `ok`, with the test asserting the repair spy/counter is `0` after a valid-JSON input AND that the returned value deep-equals `JSON.parse(input)`.
- [ ] `npm run test:grading` reports `skip-repair.test.mjs > malformed JSON triggers repair` as `ok`, with the test asserting the repair spy/counter is exactly `1` after a malformed-JSON input.
- [ ] The new test file is discovered by the existing `node --test scripts/tests/*.test.mjs` glob (verified by both subtests appearing in the `npm run test:grading` summary output).

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
- [ ] Rewrite the slice around the real owner of the parse/repair flow: `web/src/lib/chatRuntime.ts` does not contain the named JSON-repair path, while the actual parse helpers are in `web/src/lib/anthropic.ts` and the only LLM repair call site in this flow is `web/src/app/api/chat/route.ts`.
- [ ] Reconcile the goal with the current codebase before re-audit: the plan describes an LLM-based JSON-repair pass on clean JSON, but the present code path locally parses model JSON and only invokes `repairSqlWithAnthropic(...)` after SQL execution fails.

### Medium
- [ ] Update `Inputs`, `Steps`, `Changed files expected`, and the new test strategy to match the corrected owner module(s); the current Node `--test` plan cannot prove the stated behavior against `chatRuntime.ts`.

### Low
- [ ] None.

### Notes (informational only — no action)
- Repo check: `rg -n "repairSqlWithAnthropic|JSON.parse" web/src` shows the parse helpers in `web/src/lib/anthropic.ts` and the LLM repair call site in `web/src/app/api/chat/route.ts`, not in `web/src/lib/chatRuntime.ts`.
