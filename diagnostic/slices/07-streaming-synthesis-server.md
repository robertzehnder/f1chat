---
slice_id: 07-streaming-synthesis-server
phase: 7
status: pending_plan_audit
owner: claude
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T21:35:00-04:00
---

## Goal
Add a server-side streaming variant of the answer-synthesis call to `web/src/lib/anthropic.ts` that yields incremental answer-text chunks AND preserves the existing structured-answer contract (`{ answer, reasoning }` JSON). The new export does NOT touch the route, the client, or any non-synthesis call site — it only provides the streaming primitive that the next slice (`07-streaming-synthesis-route-sse`) wires into the route. The existing non-streaming export `synthesizeAnswerWithAnthropic` (in `anthropic.ts`) and its wrapper `cachedSynthesize` (in `web/src/lib/cache/answerCache.ts`, which delegates to `synthesizeAnswerWithAnthropic`) both continue to work unchanged.

## Naming clarification (current code)
- `synthesizeAnswerWithAnthropic` — exported from `web/src/lib/anthropic.ts:475`. Performs the actual non-streaming Anthropic API call via raw `fetch` to `https://api.anthropic.com/v1/messages`.
- `cachedSynthesize` — exported from `web/src/lib/cache/answerCache.ts:104`. Test-injectable indirection that forwards to `synthesizeAnswerWithAnthropic`. Not in `anthropic.ts`.
- This slice adds `synthesizeAnswerStream` to `anthropic.ts` alongside `synthesizeAnswerWithAnthropic`. It does NOT modify `cachedSynthesize` or `answerCache.ts`.

## Inputs
- `web/src/lib/anthropic.ts` — current home of `synthesizeAnswerWithAnthropic`. This file uses raw `fetch` (no SDK) and has zero `@/lib/*` or npm-package imports. The new streaming function will likewise use raw `fetch` against the Anthropic Messages API with `"stream": true`, parsing the resulting Server-Sent-Events response (`content_block_delta` events). NOTE: the Anthropic SDK (`@anthropic-ai/sdk`) is NOT currently a dependency of `web/package.json`; the implementer must NOT introduce it as part of this slice (out of scope; would require a separate dependency-bump slice).
- `diagnostic/_state.md`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/07-streaming-synthesis.md` — predecessor slice that was decomposed into three smaller slices after iter cap; its plan body and verdict history document the integration concerns this slice's narrower scope avoids.

## Required services / env
- `ANTHROPIC_API_KEY` for the live integration (existing). Tests use the same in-process stub pattern as `web/scripts/tests/answer-cache.test.mjs`; no real network call.

## Steps
1. In `web/src/lib/anthropic.ts`, add and export `synthesizeAnswerStream(input): AsyncIterable<StreamChunk>` where `StreamChunk` is a tagged union:
   - `{ kind: "answer_delta"; text: string }` — incremental chunks of the answer text as the model streams.
   - `{ kind: "reasoning_delta"; text: string }` — incremental chunks of the reasoning text.
   - `{ kind: "final"; answer: string; reasoning?: string; model: string; rawText: string }` — terminal frame that mirrors today's `synthesizeAnswerWithAnthropic` return shape exactly (`AnswerSynthesisOutput` at `web/src/lib/anthropic.ts:45-50`: `{ answer, reasoning?, model, rawText }`). The `model` field is populated from the same `DEFAULT_ANTHROPIC_MODEL` constant the existing function uses (`anthropic.ts:1`); `rawText` is the concatenated streamed text. Including `model` makes the terminal frame fully self-contained so the next sub-slice (`07-streaming-synthesis-route-sse`) can populate `ChatApiResponse.model` from the streaming output without re-reading `process.env.ANTHROPIC_MODEL` or requiring a new export of `DEFAULT_ANTHROPIC_MODEL`.
   The function calls the Anthropic Messages API directly via `fetch("https://api.anthropic.com/v1/messages", { ..., body: JSON.stringify({ ..., stream: true }) })` — same endpoint, headers, prompt, and JSON output schema as `synthesizeAnswerWithAnthropic` (existing code at `web/src/lib/anthropic.ts:475`-`:518`, which builds prompts via `buildSynthesisRequestParams` at `:149` and parses via `parseAnswerJsonPayload`). The streaming wrapper consumes the SSE response body (`content_block_delta` events with `delta.text` payloads), accumulates the JSON-shaped output as it arrives, parses the JSON progressively to detect when the `answer` field is being filled vs the `reasoning` field, and yields deltas plus a final frame. If the model returns malformed JSON at terminal-parse time, throw the same error class that `parseAnswerJsonPayload` throws today (i.e., re-use the existing parse helper on the accumulated text).
   Expected delta ordering: because the model produces JSON of the form `{"answer": "...", "reasoning": "..."}` (with `answer` before `reasoning` in the schema enforced by the existing prompt), all `answer_delta` events naturally arrive before any `reasoning_delta` events. The implementer must NOT attempt to interleave the two streams — interleaved order is not producible from this JSON shape.
2. Keep the existing `synthesizeAnswerWithAnthropic(input)` export in `anthropic.ts` unchanged (caller-compatibility for `cachedSynthesize` in `answerCache.ts`, which is the only call site, see `web/src/lib/cache/answerCache.ts:106`). The new `synthesizeAnswerStream` is a SEPARATE export sharing helper functions (`buildSynthesisRequestParams`, `parseAnswerJsonPayload`); it does NOT replace or refactor `synthesizeAnswerWithAnthropic` in this slice.
3. Add a unit test at `web/scripts/tests/streaming-synthesis-server.test.mjs` following the same transpile-and-import pattern as `web/scripts/tests/answer-cache.test.mjs`:
   - **Stubbing surface (enumeration of dependencies that the test must isolate).** `web/src/lib/anthropic.ts` has zero `@/lib/*` imports and zero npm-package imports — its only external dependencies are global `fetch` and `process.env.ANTHROPIC_API_KEY`. Therefore the test only needs to:
     - Set `process.env.ANTHROPIC_API_KEY = "test-key"` before importing the transpiled module so the API-key check at `anthropic.ts:478`-`:481` (and the analogous check in the new streaming function) does not throw.
     - Replace `globalThis.fetch` with a stub that returns a `Response` whose `body` is a `ReadableStream` emitting SSE-shaped frames (`event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<chunk>"}}\n\n`) for the streaming subtests, and standard JSON for any non-streaming probe. Restore the original `fetch` after each subtest.
     - No SDK stub is required (SDK is not used; see Inputs section).
     - No `@/lib/*` rewrites are required (no such imports exist in `anthropic.ts`).
   - **Behavior subtests.** Stub `fetch` to emit a fixed sequence of partial-JSON SSE chunks (e.g., `{"answer": "Lewis `, `Hamilton won.", "reasoning": "He `, `had the fastest pace."}`), then close. Call `synthesizeAnswerStream(...)` and collect the yielded chunks.
   - **Assertions.** At least 2 `answer_delta` chunks observed, at least 1 `reasoning_delta` chunk observed, exactly 1 `final` chunk observed, `final.answer` matches the concatenated `answer_delta` text, `final.reasoning` matches the concatenated `reasoning_delta` text, `final.model` is a non-empty string (matches `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"`), `final.rawText` is a non-empty string equal to the concatenation of all SSE delta text payloads, and all `answer_delta` events appear before all `reasoning_delta` events in the observed sequence.
   - **Malformed-JSON subtest.** Stub a stream that closes with invalid JSON (e.g., truncated mid-key); assert the iterator throws an error whose `.message` matches the substring thrown by `parseAnswerJsonPayload` today (re-use the existing error class).
   - **Non-regression subtest for `synthesizeAnswerWithAnthropic`.** Stub `fetch` to return a non-streaming JSON response (matching today's Anthropic Messages-API non-streaming shape); call `synthesizeAnswerWithAnthropic(...)` and assert the returned `{ answer, reasoning, model, rawText }` matches expected values. This guards against accidental refactor regression even though Step 2 forbids refactor.
4. No `package.json` edit required: `web/package.json:10` (`"test:grading": "node --test scripts/tests/*.test.mjs"`) auto-globs every `.test.mjs` file in `web/scripts/tests/`, so creating the file in that directory is sufficient and `package.json` does NOT appear in `Changed files expected`.

## Changed files expected
- `web/src/lib/anthropic.ts` (additive only: new `synthesizeAnswerStream` export and `StreamChunk` type; existing `synthesizeAnswerWithAnthropic` and all other exports unchanged).
- `web/scripts/tests/streaming-synthesis-server.test.mjs` (new — exercises the streaming primitive in isolation, no route, no client).
- `diagnostic/slices/07-streaming-synthesis-server.md` (frontmatter + slice-completion note).
- NOT changed: `web/package.json` (test:grading auto-globs the new file), `web/src/lib/cache/answerCache.ts` (cachedSynthesize wrapper), `web/src/app/api/chat/route.ts`, any client component.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/anthropic.ts` exports a function `synthesizeAnswerStream` with the documented `AsyncIterable<StreamChunk>` signature, and the existing `synthesizeAnswerWithAnthropic` export in `anthropic.ts` is unchanged (so `cachedSynthesize` in `web/src/lib/cache/answerCache.ts`, which delegates to it, continues to work without modification).
- [ ] `web/scripts/tests/streaming-synthesis-server.test.mjs` exists and is wired into `npm run test:grading`; all subtests in that file pass.
- [ ] All 3 gates exit 0 (build, typecheck, baseline-aware test gate with no NEW failures vs integration baseline).

## Out of scope
- Any change to `web/src/app/api/chat/route.ts` (covered by `07-streaming-synthesis-route-sse`).
- Any change to `web/src/components/chat/ChatWorkspace.tsx` or other client code (covered by `07-streaming-synthesis-client-wiring`).
- SSE response framing or `Accept: text/event-stream` handling.
- Behavior of non-LLM exit branches (clarification, cache-hit, validation-error, etc.) — those are server-route concerns covered downstream.

## Risk / rollback
- Risk: streaming JSON is malformed mid-stream. Mitigation: malformed-JSON subtest in Step 3 covers it; the iterator re-uses `parseAnswerJsonPayload` (same error class as today's `synthesizeAnswerWithAnthropic`).
- Risk: subtle accidental refactor of `synthesizeAnswerWithAnthropic` while extracting shared helpers (e.g., prompt builders, response parsers). Mitigation: (a) Step 2 explicitly forbids refactor — `synthesizeAnswerStream` is added alongside, not replacing, the existing function; (b) the non-regression subtest in Step 3 calls `synthesizeAnswerWithAnthropic` against a stubbed non-streaming `fetch` and asserts the unchanged `{ answer, reasoning, model, rawText }` shape; (c) the existing `web/scripts/tests/answer-cache.test.mjs` integration suite continues to exercise the `cachedSynthesize` → `synthesizeAnswerWithAnthropic` path end-to-end via the test:grading gate, providing an external safety net.
- Rollback: `git revert <commit>` removes the new export and test file; existing call sites are unchanged so nothing else regresses.

## Slice-completion note
(filled by claude implementer)

## Audit verdict
(filled by codex)

## Plan-audit verdict (round 1)

**Status: REVISE**
**Auditor: claude-plan-audit (round-1 forced-findings ratchet: not applied — genuine Mediums found)**

### High

### Medium
- [x] Step 3 says the test "stubs `client.messages.stream`" but does not enumerate which other imports in `web/src/lib/anthropic.ts` require stubs or rewrites when the test harness transpiles and imports the module; per the `_state.md` auditor note ("When a plan proposes direct transpilation/import of a TS module in a Node test, require explicit rewrites or stubs for every `@/lib/*` dependency"), add an explicit list of every non-SDK import in `anthropic.ts` that must be stubbed or rewritten so the transpile-and-import step is self-contained.
- [x] The Risk section claims "the unit test verifies `cachedSynthesize` returns the same `{ answer, reasoning }` payload as before for a fixed input," but Step 3 defines no such assertion — Step 3 only tests `synthesizeAnswerStream` directly; either add a `cachedSynthesize` regression subtest to Step 3 (stub the stream, call `cachedSynthesize(...)`, assert it returns `{ answer, reasoning }` with expected values) or correct the Risk mitigation to name the existing `answer-cache.test.mjs` baseline as the safety net, so the plan is internally consistent and the implementer who reads only Step 3 is not misled.

### Low
- [x] Step 4 says "wire the new test into the `npm run test:grading` runner" without stating that placing the file in `web/scripts/tests/` is sufficient (since `web/package.json:10` runs `node --test scripts/tests/*.test.mjs` automatically); add a note so the implementer does not modify `package.json`, which would then need to appear in `Changed files expected`.
- [x] The `reasoning_delta` event ordering is unspecified: because the model streams JSON where `reasoning` always follows `answer` in the schema (`{"answer": "...", "reasoning": "..."}`), all `reasoning_delta` events will necessarily arrive after all `answer_delta` events; add a sentence acknowledging this expected ordering so the implementer does not attempt interleaved answer/reasoning streaming, which the JSON structure cannot produce.

### Notes (informational only — no action)
- Gate order `build` → `typecheck` matches the existing auditor convention in `_state.md`.
- `Changed files expected` is correctly scoped: `anthropic.ts`, the new test file, and the slice frontmatter — no route or client files, consistent with Goal and Out of scope.
- The `bash scripts/loop/test_grading_gate.sh` gate is the standard baseline-aware grading gate used by other slices; consistent with Acceptance criteria AC-3.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — genuine Medium found)**

### High

### Medium
- [x] `StreamChunk.final` type definition omits `model` (and `rawText`) from `AnswerSynthesisOutput` (confirmed: `type AnswerSynthesisOutput = { answer, reasoning?, model, rawText }` at `web/src/lib/anthropic.ts:45-50`), yet Step 1 claims the terminal frame "mirrors today's `synthesizeAnswerWithAnthropic` return shape exactly." Since `DEFAULT_ANTHROPIC_MODEL` is not exported from `anthropic.ts` (it is an unexported `const`), the next sub-slice (`07-streaming-synthesis-route-sse`) will have no way to populate `ChatApiResponse.model` from the streaming output without a new export or a second `process.env` read. Either (a) add `model: string` to `StreamChunk.final` (and optionally `rawText: string`) so the terminal frame is fully self-contained, or (b) explicitly document that `model` is intentionally excluded and specify exactly how the next slice will obtain it.

### Low
- [x] `StreamChunk.final` includes `usage?: object` which does not appear in `AnswerSynthesisOutput` and is not asserted in any subtest or acceptance criterion; either document that it is populated from the Anthropic `message_delta` event's `usage` field, or remove the field if it is not needed by this slice so the interface does not carry unexplained optional state.
- [x] Acceptance criterion AC-1 reads "existing `cachedSynthesize` export is preserved" but `cachedSynthesize` lives in `answerCache.ts` (not modified by this slice); reword to "existing `synthesizeAnswerWithAnthropic` export in `anthropic.ts` is unchanged (so `cachedSynthesize` in `answerCache.ts` continues to work)" to avoid misleading the implementer about what is at risk.

### Notes (informational only — no action)
- All round-1 items (both Mediums and both Lows) are marked `[x]` and the revised plan text addresses them correctly: stub surface is enumerated, Risk/Step 3 inconsistency resolved, auto-glob note added, delta ordering specified.
- `AnswerSynthesisOutput` is not exported from `anthropic.ts`; the new `StreamChunk` type will be the only exported streaming contract surface — this is fine as long as `model` is included.
- `DEFAULT_ANTHROPIC_MODEL` reads `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"` (line 1); it is not exported, confirming the cross-slice gap.
