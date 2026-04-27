---
slice_id: 02-prompt-static-prefix-split
phase: 2
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T04:24:36Z
---

## Goal
Split the answer-synthesis prompt assembled in `synthesizeAnswerWithAnthropic` into a stable, request-independent prefix block (the system prompt content from `buildAnswerSynthesisPrompt`) and a dynamic suffix block (per-request user message containing question, SQL, row sample, runtime). Expose this split through a pure, env-free builder API so a future slice (`02-cache-control-markers`) can attach `cache_control` to the prefix without touching `synthesizeAnswerWithAnthropic`'s control flow.

## Inputs
- `web/src/lib/anthropic.ts` — `synthesizeAnswerWithAnthropic` (line ~432) and `buildAnswerSynthesisPrompt` (line ~98) are the actual call site and prefix source. (`web/src/lib/synthesisPrompts/` does not exist; do not create it.)
- `web/src/lib/chatRuntime.ts` — read-only reference to confirm it only consumes `synthesizeAnswerWithAnthropic` via `mapChatResponse` / runtime glue and does not itself assemble the synthesis prompt; it is **not** edited by this slice.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §Phase 2 (lines ~169–178). Per the roadmap, the static prefix should contain "schema overview, semantic-contract list, table allowlist, few-shot examples"; for the **answer-synthesis** prompt specifically, the current static content is the rules block returned by `buildAnswerSynthesisPrompt`. SQL-gen and repair prompt splits are explicitly out of scope here — their splits land in their own slices in this phase.

## Required services / env
None. The new builder API and its unit test must run without `ANTHROPIC_API_KEY`, without `DATABASE_URL`, and without any network call. `npm run test:grading` is invoked offline.

## Steps
1. Identify the input strings concatenated into the synthesis Anthropic request: the `system` field comes from `buildAnswerSynthesisPrompt()` (line ~98, request-independent); the `messages[0].content` (`userPrompt`, line ~443) is templated from `input.question`, `input.sql`, `input.rowCount`, `input.rows.slice(0, 25)`, and `input.runtime`.
2. In `web/src/lib/anthropic.ts`, add an exported pure function `buildSynthesisPromptParts(input: AnswerSynthesisInput): { staticPrefix: string; dynamicSuffix: string }` where:
   - `staticPrefix` is a single `string` (not an array) equal to the current `buildAnswerSynthesisPrompt()` output verbatim — byte-identical regardless of `input`.
   - `dynamicSuffix` is a single `string` equal to the current `userPrompt` template's `.trim()` output for the given `input`.
   - The function must perform no I/O, read no `process.env`, and not call `fetch`. It is a pure function of its argument.
3. Refactor `synthesizeAnswerWithAnthropic` (line ~432) to call `buildSynthesisPromptParts(input)` and pass `staticPrefix` to the request `system` field and `dynamicSuffix` as `messages[0].content`. Behavior of the outgoing HTTP request body must be unchanged byte-for-byte (`system` and user `content` fields stay equal to today's values). Do **not** add `cache_control` markers; that is `02-cache-control-markers`.
4. Add `web/scripts/tests/prompt-prefix-split.test.mjs`. The test must:
   - Import `buildSynthesisPromptParts` (and `AnswerSynthesisInput` typing if useful) from `web/src/lib/anthropic.ts` (or its compiled output, matching the pattern used by sibling `*.test.mjs` files in `web/scripts/tests/`).
   - Construct two `AnswerSynthesisInput` objects that differ in `question`, `sql`, `rowCount`, `rows`, and `runtime`.
   - Call the builder on both and assert `parts1.staticPrefix === parts2.staticPrefix` (strict string equality on the single returned string) and `parts1.dynamicSuffix !== parts2.dynamicSuffix`.
   - Run with no environment variables set; the test process must not hit the network.
5. Confirm `web/src/lib/chatRuntime.ts` does not assemble the synthesis prompt itself and therefore does not need changes; if any chatRuntime call site constructs prompt strings inline, surface that as a follow-up rather than expanding scope here.

## Changed files expected
- `web/src/lib/anthropic.ts` — add and export `buildSynthesisPromptParts`; refactor `synthesizeAnswerWithAnthropic` to use it.
- `web/scripts/tests/prompt-prefix-split.test.mjs` — new offline unit test.
- (NOT changed: `web/src/lib/chatRuntime.ts`, `web/src/lib/synthesisPrompts/` — the latter does not exist and must not be created.)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
```

## Acceptance criteria
- [ ] `buildSynthesisPromptParts` is exported from `web/src/lib/anthropic.ts` and is pure: it does not read `process.env`, does not import or call `fetch`, and does not require `ANTHROPIC_API_KEY` or `DATABASE_URL`.
- [ ] `staticPrefix` is a single `string` (not an array, not a list of objects). Two calls to `buildSynthesisPromptParts` with different `AnswerSynthesisInput` payloads return the **byte-identical** `staticPrefix` value (strict `===` equality).
- [ ] `dynamicSuffix` for the same two calls differs.
- [ ] `synthesizeAnswerWithAnthropic`'s outgoing HTTP body is unchanged: `system` equals today's `buildAnswerSynthesisPrompt()` output; user `content` equals today's `userPrompt` template output.
- [ ] `web/scripts/tests/prompt-prefix-split.test.mjs` runs offline with no `ANTHROPIC_API_KEY` set and exits 0 under `npm run test:grading`.
- [ ] `npm run typecheck` and `npm run build` succeed.

## Out of scope
- `cache_control` markers on the prefix (next slice: `02-cache-control-markers`).
- SQL-gen prompt split (`buildSystemPrompt` / `userPrompt` in the SQL-gen path) and repair prompt split — separate slices in Phase 2.
- Anthropic SDK migration / model pinning.
- Any change to `web/src/lib/chatRuntime.ts`.

## Risk / rollback
Rollback: `git revert <commit>`. Risk is low because the refactor is behaviour-preserving (same outgoing request body) and the new export is additive.

## Slice-completion note

- Branch: `slice/02-prompt-static-prefix-split`.
- Implementation commit: `5f9fd71` — `refactor(anthropic): split synthesis prompt into static prefix and dynamic suffix`.
- Files changed (within scope):
  - `web/src/lib/anthropic.ts` — exported `AnswerSynthesisInput` type; added new exported pure function `buildSynthesisPromptParts(input)` that returns `{ staticPrefix, dynamicSuffix }`; refactored `synthesizeAnswerWithAnthropic` to call the builder and pass `staticPrefix` into the request `system` field and `dynamicSuffix` into `messages[0].content`.
  - `web/scripts/tests/prompt-prefix-split.test.mjs` — new offline unit test that transpiles `web/src/lib/anthropic.ts` (matching the sibling `perf-trace.test.mjs` pattern), unsets `ANTHROPIC_API_KEY`/`DATABASE_URL`, monkey-patches `globalThis.fetch` to throw if invoked, calls the builder on two `AnswerSynthesisInput` payloads that differ in every dynamic field, and asserts `parts1.staticPrefix === parts2.staticPrefix` (strict equality, single string) and `parts1.dynamicSuffix !== parts2.dynamicSuffix`.
- Files NOT changed: `web/src/lib/chatRuntime.ts` (read-only reference; does not assemble the synthesis prompt — confirmed). `web/src/lib/synthesisPrompts/` was not created.
- Decisions:
  - `staticPrefix` is a single `string` returned verbatim from `buildAnswerSynthesisPrompt()` (the existing private helper), satisfying the Low-priority plan-audit note that the comparison target is unambiguous.
  - `dynamicSuffix` is the same trimmed user template that previously lived inline in `synthesizeAnswerWithAnthropic`, moved into the builder unchanged so the outgoing HTTP body is byte-for-byte identical (`system` and user `content` fields). No `cache_control` markers were added; that is `02-cache-control-markers`.
  - The new test imports the builder via on-the-fly TypeScript transpile to a temp `.mjs`, matching `web/scripts/tests/perf-trace.test.mjs`. It does not depend on `web/.next/` build output.
- Self-check vs acceptance criteria:
  - Pure builder: yes — `buildSynthesisPromptParts` reads no `process.env`, calls no `fetch`, requires no API key. The test runs with `ANTHROPIC_API_KEY` and `DATABASE_URL` unset and additionally throws if `fetch` is called; the test passes (subtest 19, exit 0).
  - `staticPrefix` is a single `string` and is `===`-equal across the two test inputs (`runtime`, `question`, `sql`, `rowCount`, `rows` all differ).
  - `dynamicSuffix` differs across the two test inputs.
  - HTTP body unchanged: `system: staticPrefix` is exactly `buildAnswerSynthesisPrompt()`; user `content: dynamicSuffix` is the trimmed prior `userPrompt` template, byte-equivalent — verified by the unified diff (the prior inline template was moved into the builder verbatim, no template-string edits).
- Gate exit codes (run inside `web/`):
  - `npm run typecheck` → exit 0.
  - `npm run test:grading` → exit 0 (29 subtests, 20 pass, 9 SKIP for chat propagation; new subtest 19 `buildSynthesisPromptParts returns a byte-identical staticPrefix and per-input dynamicSuffix without env or network` passes).
  - `npm run build` → exit 0 (Next.js 15.5.15 production build, all 4 static pages generated, all 21 routes compiled).
- Out-of-scope follow-up: none observed. `web/src/lib/chatRuntime.ts` does not assemble the synthesis prompt itself (it consumes `synthesizeAnswerWithAnthropic` via `mapChatResponse`/runtime glue), so no scope-expansion follow-up is needed for this slice.

## Audit verdict

**PASS**

[slice:02-prompt-static-prefix-split][pass]

Gate exit codes observed locally:
- `cd web && npm run typecheck` -> exit 0.
- `cd web && npm run test:grading` -> exit 0.
- `cd web && npm run build` -> exit 0.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/slices/02-prompt-static-prefix-split.md`, `web/scripts/tests/prompt-prefix-split.test.mjs`, and `web/src/lib/anthropic.ts`.
- This is within the expected changed files plus the implicit slice-file allowance.

Acceptance criteria:
- PASS: `buildSynthesisPromptParts` is exported from `web/src/lib/anthropic.ts` and its function body performs no I/O, reads no `process.env`, and does not call `fetch`; the offline test deletes `ANTHROPIC_API_KEY` and `DATABASE_URL` and monkey-patches `globalThis.fetch` to fail if called.
- PASS: `staticPrefix` is a single string returned from `buildAnswerSynthesisPrompt()` and is strictly equal across different inputs in subtest 19.
- PASS: `dynamicSuffix` differs across the two test inputs in subtest 19.
- PASS: `synthesizeAnswerWithAnthropic` still sends `system: staticPrefix` and user `content: dynamicSuffix`; the moved template is byte-for-byte the prior trimmed user prompt body and `staticPrefix` is the prior `buildAnswerSynthesisPrompt()` output.
- PASS: `web/scripts/tests/prompt-prefix-split.test.mjs` ran under `npm run test:grading` with no network/API-key dependency.
- PASS: `npm run typecheck` and `npm run build` succeeded.

Additional checks:
- `web/src/lib/chatRuntime.ts` does not assemble the synthesis prompt.
- `web/src/lib/synthesisPrompts/` was not created.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Correct the target files and steps so the synthesis prompt split is scoped to the code that actually assembles the synthesis Anthropic request, including `web/src/lib/anthropic.ts`, rather than only `web/src/lib/chatRuntime.ts`.
- [x] Specify a pure, testable prompt-part builder API that returns the synthesis `staticPrefix` and `dynamicSuffix` without requiring `ANTHROPIC_API_KEY` or a network call, and have the new unit test assert against that API.

### Medium
- [x] Update `Changed files expected` to include every file the revised steps obviously touch, including `web/src/lib/anthropic.ts` and excluding `web/src/lib/chatRuntime.ts` if it is no longer part of the implementation.

### Low
- [x] Clarify whether `staticPrefix` is a string or an array joined to a byte-identical string before cache markers are added, so the acceptance test has an unambiguous comparison target.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Prior round action items are resolved in the current plan body.
