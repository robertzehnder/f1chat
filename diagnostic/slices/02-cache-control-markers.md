---
slice_id: 02-cache-control-markers
phase: 2
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T04:35:39Z
---

## Goal
Attach Anthropic prompt-cache markers (`cache_control: { type: "ephemeral" }`) to the answer-synthesis static prefix so subsequent identical-prefix synthesis calls hit the prompt cache. The marker is added at the synthesis Anthropic request assembly in `web/src/lib/anthropic.ts` (the call site of `synthesizeAnswerWithAnthropic`), reusing the `staticPrefix` already exposed by the previous slice's `buildSynthesisPromptParts`.

## Inputs
- `web/src/lib/anthropic.ts` — `synthesizeAnswerWithAnthropic` (line ~462) is the actual call site that assembles the outgoing HTTP body; `buildSynthesisPromptParts` (line ~119, exported by `02-prompt-static-prefix-split`) already returns `{ staticPrefix, dynamicSuffix }` as strings.
- `web/scripts/tests/prompt-prefix-split.test.mjs` — sibling offline unit test; the new test for this slice follows the same TS-transpile import pattern.
- Anthropic Messages API prompt-caching reference: `cache_control: { type: "ephemeral" }` attached to a `system` content block. Prompt caching is GA on `anthropic-version: 2023-06-01` and does **not** require a beta header (see "Required services / env" below).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/02-prompt-static-prefix-split.md` — prior slice; merged commit `1ca375d`. Established that the synthesis prompt is split into `staticPrefix` (a single `string`, byte-identical across requests) and `dynamicSuffix` (per-request `string`), and that `synthesizeAnswerWithAnthropic` calls the builder and uses `system: staticPrefix` / `messages[0].content: dynamicSuffix`. Confirmed `web/src/lib/chatRuntime.ts` does **not** assemble the synthesis prompt and is **not** edited by this slice.

## Required services / env
None at author time. The new pure builder and its unit test must run without `ANTHROPIC_API_KEY`, without `DATABASE_URL`, and without any network call (matching the prior slice's offline pattern).

Anthropic beta header: **none required.** The repo calls `https://api.anthropic.com/v1/messages` directly via `fetch` with header `anthropic-version: 2023-06-01` (see `web/src/lib/anthropic.ts` lines 345, 428, 478) and does **not** depend on the Anthropic SDK (`web/package.json` has no `@anthropic-ai/sdk` dependency). Prompt caching via `cache_control: { type: "ephemeral" }` is GA on this API version, so no `anthropic-beta: prompt-caching-*` header is added in this slice. If a future Anthropic API change reintroduces a beta-gate, that becomes a follow-up slice.

## Steps
1. In `web/src/lib/anthropic.ts`, add an exported pure function `buildSynthesisRequestParams(input: AnswerSynthesisInput): { system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>; messages: Array<{ role: "user"; content: string }> }` that:
   - Calls `buildSynthesisPromptParts(input)` to obtain `staticPrefix` and `dynamicSuffix` (strings, unchanged).
   - Returns `system` as a single-element array containing one text content block: `{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral" } }`.
   - Returns `messages` as `[{ role: "user", content: dynamicSuffix }]` with **no** `cache_control` field on the user message or its content.
   - Performs no I/O, reads no `process.env`, and does not call `fetch`. Pure function of its argument (mirrors the prior slice's `buildSynthesisPromptParts` constraints).
2. Refactor `synthesizeAnswerWithAnthropic` (line ~462) so its outgoing request body's `system` and `messages` fields come from `buildSynthesisRequestParams(input)` rather than from `staticPrefix` (string) and an inline `messages` array. Concretely, the outgoing JSON body changes from:
   ```ts
   system: staticPrefix,
   messages: [{ role: "user", content: dynamicSuffix }]
   ```
   to:
   ```ts
   system: [{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral" } }],
   messages: [{ role: "user", content: dynamicSuffix }]
   ```
   The request URL, method, headers (`content-type`, `x-api-key`, `anthropic-version: 2023-06-01`), `model`, `max_tokens`, and `temperature` are unchanged. No new HTTP header is added.
3. Do **not** modify `generateSqlWithAnthropic` (line ~316) or `repairSqlWithAnthropic` (line ~379); their prompt splits and cache markers are out of scope for this slice (they are addressed in their own Phase 2 slices).
4. Add `web/scripts/tests/cache-control-markers.test.mjs`. The test must:
   - Match the prior slice's TS-transpile-and-import pattern (`web/scripts/tests/prompt-prefix-split.test.mjs`): read `web/src/lib/anthropic.ts`, transpile via the in-repo `typescript` package, write to a tmp `.mjs`, dynamic-import.
   - `delete process.env.ANTHROPIC_API_KEY` and `delete process.env.DATABASE_URL`, then monkey-patch `globalThis.fetch` to throw if invoked.
   - Construct two `AnswerSynthesisInput` objects that differ in `question`, `sql`, `rowCount`, `rows`, and `runtime`.
   - Call `buildSynthesisRequestParams(input)` for both and assert:
     - `params.system` is an array of length 1.
     - `params.system[0].type === "text"`.
     - `params.system[0].text === buildSynthesisPromptParts(input).staticPrefix` (i.e., the exact static-prefix string from the prior slice).
     - `params.system[0].cache_control` deep-equals `{ type: "ephemeral" }`.
     - `paramsA.system[0].text === paramsB.system[0].text` (static prefix is byte-identical across inputs, matching prior slice).
     - `params.messages.length === 1`, `params.messages[0].role === "user"`, `params.messages[0].content === buildSynthesisPromptParts(input).dynamicSuffix`.
     - `params.messages[0]` has no own `cache_control` property and `params.messages[0].content` is a plain string (no cache marker on the suffix).
     - `paramsA.messages[0].content !== paramsB.messages[0].content` (dynamic suffix differs).
     - `fetchCalled === false` (no network).

## Changed files expected
- `web/src/lib/anthropic.ts` — add exported pure function `buildSynthesisRequestParams`; refactor `synthesizeAnswerWithAnthropic` to call it and pass `system` / `messages` from its return value into the request body.
- `web/scripts/tests/cache-control-markers.test.mjs` — new offline unit test.
- (NOT changed: `web/src/lib/chatRuntime.ts` — does not assemble the synthesis prompt; `web/scripts/tests/prompt-prefix-split.test.mjs` — covers the prior slice and stays as-is.)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
```

## Acceptance criteria
- [ ] `buildSynthesisRequestParams` is exported from `web/src/lib/anthropic.ts` and is pure: it does not read `process.env`, does not import or call `fetch`, and does not require `ANTHROPIC_API_KEY` or `DATABASE_URL`.
- [ ] `synthesizeAnswerWithAnthropic`'s outgoing request body has `system` as a one-element array `[{ type: "text", text: <staticPrefix>, cache_control: { type: "ephemeral" } }]` where `<staticPrefix>` equals `buildSynthesisPromptParts(input).staticPrefix` byte-for-byte.
- [ ] The user message in the outgoing body remains `{ role: "user", content: <dynamicSuffix> }` with **no** `cache_control` marker on the message or on its `content`.
- [ ] No new HTTP headers are added to the synthesis request; `anthropic-version: 2023-06-01` is unchanged and no `anthropic-beta` header is introduced.
- [ ] `web/scripts/tests/cache-control-markers.test.mjs` runs offline (no `ANTHROPIC_API_KEY`, no network) under `npm run test:grading` and exits 0, asserting the bullets above on `buildSynthesisRequestParams`'s structured return value.
- [ ] `npm run typecheck` and `npm run build` succeed.
- [ ] `generateSqlWithAnthropic` and `repairSqlWithAnthropic` are unchanged (no cache_control added to SQL-gen / repair paths in this slice).

## Out of scope
- Cache markers on the SQL-generation prompt (`buildSystemPrompt`) or the repair prompt (`buildRepairPrompt`) — separate Phase 2 slices.
- Anthropic SDK migration / model pinning.
- Any change to `web/src/lib/chatRuntime.ts`.
- Cache-hit telemetry or perf-metric emission for the cached prefix — separate slice.
- Adjusting `anthropic-version` or adding any beta header.

## Risk / rollback
Rollback: `git revert <commit>`. Risk is low: the change is a structural reshape of the `system` field of one outgoing request (string → single-block array with cache marker). The text content of the static prefix is unchanged, the user-message content is unchanged, and the new builder is a pure additive export. If Anthropic ever rejects the array-form `system`, revert is one commit.

## Slice-completion note

- Branch: `slice/02-cache-control-markers`
- Implementation commit: `26b0082` — feat: attach ephemeral cache_control to synthesis static prefix
  - Adds exported pure function `buildSynthesisRequestParams(input)` in `web/src/lib/anthropic.ts` that returns `{ system: [{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: dynamicSuffix }] }`. It calls `buildSynthesisPromptParts(input)` for prefix/suffix; performs no I/O, reads no `process.env`, and does not call `fetch`.
  - Refactors `synthesizeAnswerWithAnthropic` (lines ~475–509 post-edit) to destructure `{ system, messages } = buildSynthesisRequestParams(input)` and pass them into the request body. URL, method, headers (`content-type`, `x-api-key`, `anthropic-version: 2023-06-01`), `model`, `max_tokens`, and `temperature` are unchanged. No new HTTP header (no `anthropic-beta`).
  - `generateSqlWithAnthropic` and `repairSqlWithAnthropic` are untouched.
  - Adds `web/scripts/tests/cache-control-markers.test.mjs` (TS-transpile-and-import, mirrors `prompt-prefix-split.test.mjs`). Deletes `ANTHROPIC_API_KEY`/`DATABASE_URL`, monkey-patches `globalThis.fetch` to throw, then asserts: `system` length 1, `system[0].type === "text"`, `system[0].text === buildSynthesisPromptParts(input).staticPrefix`, `system[0].cache_control` deep-equals `{ type: "ephemeral" }`, byte-identical static prefix across inputs, `messages.length === 1`, `messages[0].role === "user"`, `messages[0].content === dynamicSuffix`, plain string content, no own `cache_control` on the user message, suffix differs across inputs, and `fetchCalled === false`.

### Decisions
- Kept `buildSynthesisPromptParts` unchanged and made `buildSynthesisRequestParams` call it, so the prior slice's contract (string `staticPrefix`/`dynamicSuffix`) is preserved and the new builder is purely additive.
- No `anthropic-beta` header added: prompt caching is GA on `anthropic-version: 2023-06-01`, matching the slice's "no beta header" decision.
- Cache marker placed only on the static-prefix system block. No `cache_control` on the user message or its `content`.

### Gate command results
- `cd web && npm run typecheck` → exit 0
- `cd web && npm run test:grading` → exit 0 (30 tests, 21 pass, 9 skipped, 0 fail; new test `buildSynthesisRequestParams attaches ephemeral cache_control to the static prefix only, with no env or network` passes)
- `cd web && npm run build` → exit 0 (Next.js build succeeded; static pages generated; route table unchanged)

### Self-check vs. acceptance criteria
- [x] `buildSynthesisRequestParams` is exported and pure — verified by inspection (no `process.env`, no `fetch`, no other I/O) and by the new test running with `ANTHROPIC_API_KEY`/`DATABASE_URL` deleted and a throwing `fetch`.
- [x] Outgoing `system` is `[{ type: "text", text: <staticPrefix>, cache_control: { type: "ephemeral" } }]` with `<staticPrefix>` byte-equal to `buildSynthesisPromptParts(input).staticPrefix` — asserted in the test.
- [x] User message remains `{ role: "user", content: <dynamicSuffix> }` with no `cache_control` on the message or its `content` — asserted in the test (`hasOwnProperty('cache_control') === false`, `typeof content === "string"`).
- [x] No new HTTP header; `anthropic-version: 2023-06-01` unchanged — verified by diff (header block untouched).
- [x] Test runs offline under `npm run test:grading` and exits 0 — confirmed.
- [x] `npm run typecheck` and `npm run build` succeed — confirmed.
- [x] `generateSqlWithAnthropic` and `repairSqlWithAnthropic` unchanged — verified by diff (only the synthesis call site and a new export were modified).

## Audit verdict

**PASS**

[slice:02-cache-control-markers][pass]

Gate exit codes observed locally:
- `cd web && npm run typecheck` -> exit 0.
- `cd web && npm run test:grading` -> exit 0.
- `cd web && npm run build` -> exit 0.

Scope diff:
- `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/slices/02-cache-control-markers.md`, `web/scripts/tests/cache-control-markers.test.mjs`, and `web/src/lib/anthropic.ts`.
- This is within the expected changed files plus the implicit slice-file allowance.

Acceptance criteria:
- PASS: `buildSynthesisRequestParams` is exported from `web/src/lib/anthropic.ts` and its function body only calls `buildSynthesisPromptParts(input)` and constructs return data; it does not read `process.env`, call `fetch`, or perform I/O. The offline test deletes `ANTHROPIC_API_KEY` and `DATABASE_URL` and monkey-patches `globalThis.fetch` to fail if invoked.
- PASS: `synthesizeAnswerWithAnthropic` now sends `system` from `buildSynthesisRequestParams(input)`, a one-element text block array whose `text` is the byte-identical `buildSynthesisPromptParts(input).staticPrefix` and whose `cache_control` is `{ type: "ephemeral" }`.
- PASS: The outgoing user message remains `{ role: "user", content: dynamicSuffix }`; the test asserts `content` is a plain string and the message has no own `cache_control` property.
- PASS: No synthesis HTTP headers changed. The header block still contains `content-type`, `x-api-key`, and `anthropic-version: 2023-06-01`; no `anthropic-beta` header was introduced.
- PASS: `web/scripts/tests/cache-control-markers.test.mjs` ran under `npm run test:grading` with no API-key, database, or network dependency; subtest 1 passed.
- PASS: `npm run typecheck` and `npm run build` succeeded.
- PASS: `generateSqlWithAnthropic` and `repairSqlWithAnthropic` are unchanged by the diff and have no `cache_control` markers.

Additional checks:
- `rg -n "cache_control|anthropic-beta"` shows cache markers only in the synthesis request builder and its test, and no `anthropic-beta` header.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Correct the target file and steps to apply cache-control markers at the synthesis Anthropic request assembly in `web/src/lib/anthropic.ts`, because prior slice `02-prompt-static-prefix-split` explicitly left `web/src/lib/chatRuntime.ts` read-only and confirmed it does not assemble the synthesis prompt.
- [x] Specify the exact Anthropic request shape that carries `cache_control` for the static prefix, including whether the existing string `system` field must become a content-block array or another SDK-supported structure.

### Medium
- [x] Update `Changed files expected` to include every file the revised steps touch, including `web/src/lib/anthropic.ts`, and exclude `web/src/lib/chatRuntime.ts` unless the revised plan identifies a concrete runtime change there.
- [x] Make the beta-header requirement testable by naming the exact header/configuration to add for the repo's installed Anthropic SDK version, or explicitly state that no beta header is required and why.
- [x] Update the unit-test step wording so it asserts cache-control on the static prefix request payload rather than a "prefix message", since the prior split exposes `staticPrefix` as the synthesis `system` content and the dynamic suffix as `messages[0].content`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Prior round action items are resolved in the current plan body.
