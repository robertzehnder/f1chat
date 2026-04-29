---
slice_id: 07-streaming-synthesis
phase: 7
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Stream the synthesis response to the client as tokens arrive, rather than buffering the full response. Improves perceived latency for long answers.

## Inputs
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Decisions
- **Transport.** Next.js App-Router route handlers return a Web `Response` whose body is a `ReadableStream<Uint8Array>` — there is no Node `ServerResponse.write()`. Streaming assertions therefore consume `response.body` via `getReader()` and count discrete `read()` results, not `write()` calls.
- **UI scope (resolves Low #1).** Step 3 is **planned scope, not contingent**: `web/src/components/chat/ChatPanel.tsx` will be modified to consume the streaming body via `response.body.getReader()` and progressively append tokens to the rendered assistant message instead of awaiting the full response. The deterministic UI gate below verifies this.

## Steps
1. Switch the route handler in `web/src/app/api/chat/route.ts` to return a streaming `Response` whose body is a `ReadableStream<Uint8Array>` produced from the synthesis async iterator. Set `Content-Type: text/plain; charset=utf-8` and `Cache-Control: no-store, no-transform`. Do not change the route's contract for non-streamed callers beyond making the body chunked.
2. Update `web/src/lib/chatRuntime.ts` synthesis to expose an async iterator (or `ReadableStream`) that yields partial token strings as they are produced, rather than buffering the full string. Preserve existing return shape for any non-streaming caller by adding a parallel streaming entry point — do not break the buffered API used by tests outside this slice.
3. Update `web/src/components/chat/ChatPanel.tsx` to consume the streaming body via `response.body.getReader()` (TextDecoder for chunk decoding) and progressively append decoded chunks to the rendered assistant message. The legacy "await full text, then render" path is replaced.
4. Add `web/scripts/tests/streaming-synthesis.test.mjs` that:
   - invokes the route handler (or its exported `POST`) and asserts `response.body` is a `ReadableStream`;
   - reads the body via `response.body.getReader()` in a loop, recording each non-empty `value` returned before `done === true`;
   - asserts the number of recorded chunks is **≥ 3** for a multi-paragraph synthesis fixture (no reliance on `ServerResponse.write()`);
   - asserts the concatenated decoded chunks equal the full expected answer (correctness, not just chunkiness).
5. Add `web/scripts/tests/streaming-ui.test.mjs` as the deterministic UI gate (resolves Medium #1): render `ChatPanel` against a stub `fetch` that returns a `Response` whose body is a `ReadableStream` emitting three queued chunks with explicit `await` between enqueues. Assert that after each chunk is enqueued and flushed, the rendered DOM contains the cumulative concatenation of chunks so far (i.e. the UI updates incrementally rather than only after the stream closes). Use the existing test runner conventions (`node --test` under `web/scripts/tests/*.test.mjs`, JSDOM or React testing-library if already in `web/package.json`; if not, drive the component's stream-consumer function directly and assert state updates per chunk).

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatPanel.tsx`
- `web/scripts/tests/streaming-synthesis.test.mjs`
- `web/scripts/tests/streaming-ui.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```
(`test:grading` is `node --test scripts/tests/*.test.mjs`, so both new `*.test.mjs` files are picked up automatically — no script change needed.)

## Acceptance criteria
- [ ] `streaming-synthesis.test.mjs` asserts `response.body instanceof ReadableStream` and that `response.body.getReader()` yields ≥ 3 distinct non-empty chunks before `{ done: true }` for a multi-paragraph answer, and that the concatenated chunks equal the expected full answer.
- [ ] `streaming-ui.test.mjs` asserts that `ChatPanel` (or its stream-consumer) renders the cumulative concatenation of chunks after each chunk arrives, not only after the stream closes — i.e. the UI streams. This is the deterministic gate for the UI claim; no manual verification.

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
- [x] Replace the `write()`-based streaming assertion with a transport-accurate chunk assertion against the `Response`/`ReadableStream` body, because this slice does not use a Node `ServerResponse` writer (`diagnostic/slices/07-streaming-synthesis.md:25`, `diagnostic/slices/07-streaming-synthesis.md:28`, `diagnostic/slices/07-streaming-synthesis.md:47`).

### Medium
- [x] Add a deterministic gate or test target for the UI streaming claim so “Chat UI renders streamed content” is verifiable by a command rather than a manual check (`diagnostic/slices/07-streaming-synthesis.md:27`, `diagnostic/slices/07-streaming-synthesis.md:43`, `diagnostic/slices/07-streaming-synthesis.md:48`).

### Low
- [x] Clarify whether Step 3 is expected to modify the UI or only verify existing behavior, so the implementer knows whether `web/src/components/chat/ChatPanel.tsx` is planned scope or contingent scope (`diagnostic/slices/07-streaming-synthesis.md:27`, `diagnostic/slices/07-streaming-synthesis.md:33`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `web/package.json` currently defines `test:grading` as `node --test scripts/tests/*.test.mjs`, so the planned test path is covered by the existing gate.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Specify how `/api/chat` preserves or migrates existing structured JSON callers before switching the route body to streamed `text/plain`; the current plan conflicts with the declared `ChatApiResponse` contract and existing consumers at `web/src/lib/chatTypes.ts:66`, `web/src/components/chat/ChatWorkspace.tsx:194`, `web/scripts/chat-health-check.mjs:128`, and `web/scripts/tests/session-propagation.test.mjs:42`.

### Medium
- [ ] Replace every `ChatPanel.tsx` reference with the actual chat UI module that owns the `/api/chat` fetch and assistant rendering flow, and align `Inputs`, `Steps`, `Changed files expected`, and the UI gate accordingly; the current path does not exist, while the live fetch path is `web/src/components/chat/ChatWorkspace.tsx:183`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `cd web && npm run build` before `cd web && npm run typecheck` matches the current auditor note for web slices.
