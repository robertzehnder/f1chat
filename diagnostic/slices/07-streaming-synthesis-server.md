---
slice_id: 07-streaming-synthesis-server
phase: 7
status: pending_plan_audit
owner: claude
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T15:40:00-04:00
---

## Goal
Add a server-side streaming variant of `cachedSynthesize` to `web/src/lib/anthropic.ts` that yields incremental answer-text chunks AND preserves the existing structured-answer contract (`{ answer, reasoning }` JSON). The new export does NOT touch the route, the client, or any non-synthesis call site — it only provides the streaming primitive that the next slice (`07-streaming-synthesis-route-sse`) wires into the route. Existing non-streaming `cachedSynthesize` callers continue to work unchanged.

## Inputs
- `web/src/lib/anthropic.ts` — current home of `cachedSynthesize`. The Anthropic SDK already supports streaming via `client.messages.stream()`; this slice wraps that into a function with the same input shape as `cachedSynthesize` but an `AsyncIterable` output.
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
   - `{ kind: "final"; answer: string; reasoning: string; usage?: object }` — terminal frame that mirrors today's `cachedSynthesize` return shape exactly.
   The function uses `client.messages.stream(...)` with the same prompt and JSON output schema as `cachedSynthesize` (the existing code at `web/src/lib/anthropic.ts:101`, `:149`, `:289` already produces JSON with `answer` and `reasoning`). The streaming wrapper accumulates the JSON-shaped output as it arrives, parses progressively, and yields deltas plus a final frame. If the model returns malformed JSON, throw the same error type `cachedSynthesize` throws today.
2. Keep `cachedSynthesize(input)` exported and unchanged (caller-compatibility). It can either remain a separate non-streaming implementation OR be implemented internally as `await Array.from(synthesizeAnswerStream(input))` filtering for the `final` frame — implementer's call. Either way, every existing caller continues to work without edits.
3. Add a unit test at `web/scripts/tests/streaming-synthesis-server.test.mjs` that:
   - Stubs `client.messages.stream` to emit a fixed sequence of partial JSON chunks, then a final close.
   - Calls `synthesizeAnswerStream(...)` and collects the yielded chunks.
   - Asserts: at least 2 `answer_delta` chunks observed, at least 1 `reasoning_delta` chunk observed, exactly 1 `final` chunk observed, the `final.answer` matches the concatenated answer_delta text, and `final.reasoning` matches the concatenated reasoning_delta text.
   - Tests malformed JSON: stubs an invalid-JSON stream, asserts the iterator throws the expected error type.
4. Wire the new test into the `npm run test:grading` runner so the gate exercises it.

## Changed files expected
- `web/src/lib/anthropic.ts` (additive: new `synthesizeAnswerStream` export and `StreamChunk` type; existing `cachedSynthesize` either unchanged or refactored to delegate, implementer's choice — no behavior change).
- `web/scripts/tests/streaming-synthesis-server.test.mjs` (new — exercises the streaming primitive in isolation, no route, no client).
- `diagnostic/slices/07-streaming-synthesis-server.md` (frontmatter + slice-completion note).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/anthropic.ts` exports a function `synthesizeAnswerStream` with the documented `AsyncIterable<StreamChunk>` signature; existing `cachedSynthesize` export is preserved.
- [ ] `web/scripts/tests/streaming-synthesis-server.test.mjs` exists and is wired into `npm run test:grading`; all subtests in that file pass.
- [ ] All 3 gates exit 0 (build, typecheck, baseline-aware test gate with no NEW failures vs integration baseline).

## Out of scope
- Any change to `web/src/app/api/chat/route.ts` (covered by `07-streaming-synthesis-route-sse`).
- Any change to `web/src/components/chat/ChatWorkspace.tsx` or other client code (covered by `07-streaming-synthesis-client-wiring`).
- SSE response framing or `Accept: text/event-stream` handling.
- Behavior of non-LLM exit branches (clarification, cache-hit, validation-error, etc.) — those are server-route concerns covered downstream.

## Risk / rollback
- Risk: streaming JSON is malformed mid-stream. Mitigation: test case covers it; iterator throws the same error type as today's `cachedSynthesize`.
- Risk: subtle change to `cachedSynthesize` semantics if implementer chooses to refactor it as a wrapper around the streaming variant. Mitigation: the unit test verifies `cachedSynthesize` returns the same `{ answer, reasoning }` payload as before for a fixed input.
- Rollback: `git revert <commit>` removes the new export and test file; existing call sites are unchanged so nothing else regresses.

## Slice-completion note
(filled by claude implementer)

## Audit verdict
(filled by codex)
