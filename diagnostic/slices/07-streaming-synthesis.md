---
slice_id: 07-streaming-synthesis
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-29
---

## Goal
Stream the synthesis response to the client as tokens arrive, rather than buffering the full response. Improves perceived latency for long answers.

## Inputs
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatWorkspace.tsx`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Decisions
- **Transport.** Next.js App-Router route handlers return a Web `Response` whose body is a `ReadableStream<Uint8Array>` — there is no Node `ServerResponse.write()`. Streaming assertions therefore consume `response.body` via `getReader()` and count discrete `read()` results, not `write()` calls.
- **Consumer compatibility (resolves round-2 High).** The existing `/api/chat` JSON contract (`ChatApiResponse` defined at `web/src/lib/chatTypes.ts:66`) is preserved as the **default** response. Every existing structured-JSON caller continues to receive an identical `ChatApiResponse` JSON body, with no migration required:
  - `web/scripts/chat-health-check.mjs:128` (reads `payload.answer`, `payload.sql`, `payload.adequacyGrade`, `payload.requestId`, `payload.runtime?.*`, etc.)
  - `web/scripts/tests/session-propagation.test.mjs:42` (reads `payload.runtime.resolution.*`, `payload.sql`, `payload.generationSource`, `payload.generationNotes`, `payload.answer`)
  - any other current or future caller that does not opt into streaming
  Streaming is **opt-in** via the request `Accept: text/event-stream` header. Only `ChatWorkspace.tsx` sends that header in this slice; the health-check script and session-propagation tests are unchanged. The streamed body is SSE: a sequence of `data: {"type":"delta","text":"<chunk>"}\n\n` events for token chunks, followed by exactly one terminal `data: {"type":"final","payload":<ChatApiResponse>}\n\n` event carrying the complete structured payload (sql, runtime, requestId, etc.). The UI therefore still receives a full `ChatApiResponse` at the end, preserving `mapChatApiResponseToParts` and `deriveResolvedContext` without change.
- **UI scope (resolves round-1 Low #1 and round-2 Medium).** The chat UI module that owns the `/api/chat` fetch and assistant rendering flow is `web/src/components/chat/ChatWorkspace.tsx` (verified at `ChatWorkspace.tsx:183`). The previously-named `ChatPanel.tsx` does not exist. Step 3 modifies `ChatWorkspace.tsx` to consume the SSE body via `response.body.getReader()` + `TextDecoder` and progressively append delta tokens to the rendered assistant message. The deterministic UI gate (Step 5) targets the same module.

## Steps
1. Switch `web/src/app/api/chat/route.ts` to branch on the request `Accept` header. **JSON path (default, no `Accept: text/event-stream`):** behavior identical to today — return the structured `ChatApiResponse` JSON exactly as currently shaped (no field added or removed). **SSE path** (`Accept` includes `text/event-stream`): return a streaming `Response` with `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store, no-transform`. Body is a `ReadableStream<Uint8Array>` that emits, in order, one or more `data: {"type":"delta","text":"<chunk>"}\n\n` SSE frames as synthesis tokens arrive, then exactly one terminal `data: {"type":"final","payload":<full ChatApiResponse>}\n\n` frame, then closes. Errors on the SSE path are emitted as a single `data: {"type":"error","payload":<ChatApiResponse-with-error>}\n\n` frame followed by stream close (mirrors the JSON error shape so the UI can fall back to existing error handling).
2. Update `web/src/lib/chatRuntime.ts` synthesis to expose an async iterator (or `ReadableStream`) that yields partial token strings as they are produced, **in addition to** the existing buffered API. The buffered entry point used by the JSON path and by every caller outside this slice MUST remain intact and call-compatible (same exported name, same return shape). The streaming entry point internally uses the same answer-composition logic so that the concatenation of yielded tokens equals the legacy buffered answer for the same inputs.
3. Update `web/src/components/chat/ChatWorkspace.tsx` `send()` to set `Accept: text/event-stream` on the `/api/chat` fetch, then read `response.body` via `getReader()` + `TextDecoder` and parse SSE frames. On each `delta` frame, append the chunk text to the assistant message's text part and re-set state so the rendered DOM updates progressively (no awaiting the full response). On the `final` frame, take the embedded `ChatApiResponse` payload and run the existing post-response logic unchanged (`mapChatApiResponseToParts`, `deriveResolvedContext`, `setResolved`, `setComposerCtx`, `lastResolved` patch, then `setLoading(false)`). On the `error` frame, mirror the current error branch using `payload.error` / `payload.requestId`. Factor the SSE-consumer into a small exported helper (e.g. `consumeChatStream(response, callbacks)` co-located in `ChatWorkspace.tsx` or a sibling file under `web/src/components/chat/`) so the UI gate can drive it directly without DOM rendering.
4. Add `web/scripts/tests/streaming-synthesis.test.mjs` that:
   - **JSON-compatibility assertion (resolves round-2 High):** invokes the route handler's exported `POST` with **no** `Accept: text/event-stream` (e.g. `Accept: application/json` or omitted) for a fixture request and asserts (a) `response.headers.get("content-type")` starts with `application/json`, (b) `await response.json()` returns an object that contains every `ChatApiResponse` field actually consumed by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs` — at minimum `answer`, `sql`, `requestId`, `generationSource`, `generationNotes`, `adequacyGrade`, `adequacyReason`, and the `runtime.resolution.selectedSession.sessionKey` / `runtime.resolution.needsClarification` / `runtime.resolution.selectedDriverNumbers` paths — proving the legacy contract is intact for non-streaming callers.
   - **Streaming assertion:** invokes the same `POST` with `Accept: text/event-stream` for a multi-paragraph fixture and asserts `response.body instanceof ReadableStream` and `response.headers.get("content-type")` includes `text/event-stream`. Reads the body via `response.body.getReader()` in a loop, decodes with `TextDecoder`, parses SSE frames, and asserts (a) the count of distinct `delta` frames is **≥ 3**, (b) exactly one terminal `final` frame is emitted, and (c) the concatenated `delta.text` values equal `final.payload.answer` (correctness, not just chunkiness).
5. Add `web/scripts/tests/streaming-ui.test.mjs` as the deterministic UI gate (resolves round-1 Medium #1): drive the `ChatWorkspace` SSE-consumer helper extracted in Step 3 against a stub `Response` whose body is a `ReadableStream` emitting three queued `data: {"type":"delta","text":"<chunk>"}\n\n` frames with explicit `await` between enqueues, then a `data: {"type":"final","payload":{...}}\n\n` frame. Assert that after each `delta` is enqueued and flushed, a callback (or observable state) exposed by the consumer holds the **cumulative concatenation** of delta texts so far — i.e. the UI updates incrementally rather than only after the stream closes — and that on the `final` frame the consumer surfaces the embedded `ChatApiResponse` payload to its done callback. Use existing test-runner conventions (`node --test` under `web/scripts/tests/*.test.mjs`).

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatWorkspace.tsx`
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
- [ ] `streaming-synthesis.test.mjs`'s **JSON-compatibility assertion** passes: when invoked without `Accept: text/event-stream`, the `POST` handler returns `Content-Type: application/json` and a JSON body containing every `ChatApiResponse` field consumed by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs` (`answer`, `sql`, `requestId`, `generationSource`, `generationNotes`, `adequacyGrade`, `adequacyReason`, `runtime.resolution.selectedSession.sessionKey`, `runtime.resolution.needsClarification`, `runtime.resolution.selectedDriverNumbers`). No consumer migration required.
- [ ] `streaming-synthesis.test.mjs`'s **streaming assertion** passes: when invoked with `Accept: text/event-stream`, `response.body instanceof ReadableStream`, the response emits ≥ 3 distinct `delta` SSE frames before exactly one terminal `final` frame, and the concatenated `delta.text` values equal `final.payload.answer`.
- [ ] `streaming-ui.test.mjs` asserts that the `ChatWorkspace` SSE-consumer surfaces the cumulative concatenation of delta texts after each delta frame arrives (not only after the stream closes) and surfaces the `final` payload to its done callback. Deterministic gate; no manual verification.

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
- [x] Specify how `/api/chat` preserves or migrates existing structured JSON callers before switching the route body to streamed `text/plain`; the current plan conflicts with the declared `ChatApiResponse` contract and existing consumers at `web/src/lib/chatTypes.ts:66`, `web/src/components/chat/ChatWorkspace.tsx:194`, `web/scripts/chat-health-check.mjs:128`, and `web/scripts/tests/session-propagation.test.mjs:42`.

### Medium
- [x] Replace every `ChatPanel.tsx` reference with the actual chat UI module that owns the `/api/chat` fetch and assistant rendering flow, and align `Inputs`, `Steps`, `Changed files expected`, and the UI gate accordingly; the current path does not exist, while the live fetch path is `web/src/components/chat/ChatWorkspace.tsx:183`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `cd web && npm run build` before `cd web && npm run typecheck` matches the current auditor note for web slices.
