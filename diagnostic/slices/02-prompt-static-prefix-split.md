---
slice_id: 02-prompt-static-prefix-split
phase: 2
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T04:18:45Z
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
