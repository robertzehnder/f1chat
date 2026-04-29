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
- `web/src/components/chat/streamingConsumer.ts` (new — see Decisions: helper file location)

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
- **UI scope (resolves round-1 Low #1 and round-2 Medium).** The chat UI module that owns the `/api/chat` fetch and assistant rendering flow is `web/src/components/chat/ChatWorkspace.tsx` (verified at `ChatWorkspace.tsx:183`). The previously-named `ChatPanel.tsx` does not exist. Step 3 modifies `ChatWorkspace.tsx` to consume the SSE body via `response.body.getReader()` + `TextDecoder` and progressively append delta tokens to the rendered assistant message.
- **Helper file location (resolves round-3 Medium #2).** The SSE-consumer logic is factored into a new sibling **plain `.ts`** module at `web/src/components/chat/streamingConsumer.ts` (NOT colocated inside `ChatWorkspace.tsx`). Reason: the deterministic UI gate (Step 5) must transpile and import the helper under `node --test`; keeping it out of the `.tsx` file means the test harness does not need to handle JSX or React-DOM imports — only plain TS → JS transpilation. `ChatWorkspace.tsx` imports the helper and supplies the rendering-side callbacks. This file is in scope for this slice and is listed under both `Inputs` and `Changed files expected`.
- **Test-harness strategy for Steps 4 and 5 (resolves round-3 High).** Both new tests follow the established self-contained `node --test` pattern used by `web/scripts/tests/skip-repair.test.mjs` and `web/scripts/tests/route-trace.test.mjs`: read the TS source via `node:fs/promises.readFile`, rewrite `@/lib/*` and `next/server` imports to local stub files, transpile with the already-installed `typescript` devDependency via `ts.transpileModule(...)` (`module: ESNext`, `target: ES2022`), write the output to a `mkdtemp`'d directory, and `await import(...)` the resulting `.mjs`. No new devDependency is required — `typescript` and `tsx` are already in `web/package.json:34`. `web/package.json:10` runs `test:grading` as `node --test scripts/tests/*.test.mjs`, so dropping the new files into `scripts/tests/` is sufficient — no script change needed.
  - For Step 4 (`streaming-synthesis.test.mjs`), the harness mirrors `skip-repair.test.mjs:152-209`: rewrite all of `route.ts`'s `next/server`, `@/lib/cache/answerCache`, `@/lib/anthropic`, `@/lib/queries`, `@/lib/deterministicSql`, `@/lib/chatRuntime`, `@/lib/chatQuality`, `@/lib/answerSanity`, `@/lib/serverLog`, `@/lib/perfTrace`, `@/lib/zeroLlmGuard` imports to local `.stub.mjs` files (the same stubs already used by `skip-repair.test.mjs` are sufficient — copy or share them via a `scripts/tests/fixtures/` helper). The `chatRuntime` stub returns a fake runtime whose synthesis path emits ≥ 3 token chunks (e.g. `__setBuildChatRuntimeImpl` configures the synthesis iterator to yield three chunks for the streaming assertion). Existing stub modules (`NEXT_SERVER_STUB`, `ANTHROPIC_STUB`, `QUERIES_STUB`, `DETERMINISTIC_SQL_STUB`, `CHAT_RUNTIME_STUB`, `CHAT_QUALITY_STUB`, `ANSWER_SANITY_STUB`, `SERVER_LOG_STUB`, `PERF_TRACE_STUB`, `ZERO_LLM_GUARD_STUB`) are sufficient — no new stub modules required beyond extending `CHAT_RUNTIME_STUB` to expose a configurable streaming-synthesis iterator. The route is then exercised by constructing a `Request` (`new Request("http://localhost/api/chat", { method: "POST", headers: { "Accept": "...", "content-type": "application/json" }, body: JSON.stringify({ message }) })`) and calling the transpiled `route.POST(req)`.
  - For Step 5 (`streaming-ui.test.mjs`), the harness only needs to transpile the new `web/src/components/chat/streamingConsumer.ts` (no `@/...` imports — see Decisions § Helper file location). The test reads it via `readFile`, transpiles with `ts.transpileModule`, writes to a tmp dir, and imports it. The driver constructs a stub `Response` whose body is a `ReadableStream` (built via `new ReadableStream({ start(controller) { ... } })`) emitting queued SSE frames, and asserts the consumer's incremental callbacks. Because the helper file is plain TS with no React, JSX, or browser-only imports, no `@/...` rewrites or DOM stubs are required.

## Steps
1. Switch `web/src/app/api/chat/route.ts` to branch on the request `Accept` header. **JSON path (default, no `Accept: text/event-stream`):** behavior identical to today — return the structured `ChatApiResponse` JSON exactly as currently shaped (no field added or removed). **SSE path** (`Accept` includes `text/event-stream`): return a streaming `Response` with `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store, no-transform`. Body is a `ReadableStream<Uint8Array>` that emits, in order, one or more `data: {"type":"delta","text":"<chunk>"}\n\n` SSE frames as synthesis tokens arrive, then exactly one terminal `data: {"type":"final","payload":<full ChatApiResponse>}\n\n` frame, then closes. Errors on the SSE path are emitted as a single `data: {"type":"error","payload":<ChatApiResponse-with-error>}\n\n` frame followed by stream close (mirrors the JSON error shape so the UI can fall back to existing error handling).
2. Update `web/src/lib/chatRuntime.ts` synthesis to expose an async iterator (or `ReadableStream`) that yields partial token strings as they are produced, **in addition to** the existing buffered API. The buffered entry point used by the JSON path and by every caller outside this slice MUST remain intact and call-compatible (same exported name, same return shape). The streaming entry point internally uses the same answer-composition logic so that the concatenation of yielded tokens equals the legacy buffered answer for the same inputs.
3. Create `web/src/components/chat/streamingConsumer.ts` exporting a plain-TS helper `consumeChatStream(response: Response, callbacks: { onDelta(cumulativeText: string, chunkText: string): void; onFinal(payload: ChatApiResponse): void; onError(payload: ChatApiResponse): void }): Promise<void>`. The helper reads `response.body` via `getReader()` + `TextDecoder`, buffers partial SSE frames across reads, parses `data: {...}\n\n` frames, and invokes the matching callback for each frame. The helper has NO React, JSX, browser-DOM, or `@/lib/*` imports — it imports only the `ChatApiResponse` type from `@/lib/chatTypes` (a type-only import that is erased at transpile time, so the deterministic UI gate's transpile step does not need to resolve it). Then update `web/src/components/chat/ChatWorkspace.tsx` `send()` to set `Accept: text/event-stream` on the `/api/chat` fetch and call `consumeChatStream(response, { onDelta, onFinal, onError })`. The `onDelta` callback appends the chunk text to the assistant message's text part and re-sets state so the rendered DOM updates progressively (no awaiting the full response). The `onFinal` callback takes the embedded `ChatApiResponse` payload and runs the existing post-response logic unchanged (`mapChatApiResponseToParts`, `deriveResolvedContext`, `setResolved`, `setComposerCtx`, `lastResolved` patch, then `setLoading(false)`). The `onError` callback mirrors the current error branch using `payload.error` / `payload.requestId`.
4. Add `web/scripts/tests/streaming-synthesis.test.mjs` that builds a self-contained route harness following the pattern in `web/scripts/tests/skip-repair.test.mjs:152-209` (read TS source, rewrite `next/server` and every `@/lib/*` import to local stub `.mjs` files, transpile with `ts.transpileModule` from the already-installed `typescript` devDependency, write outputs to a `mkdtemp`'d directory, `await import(...)` the resulting `.mjs`). The same set of stubs (`NEXT_SERVER_STUB`, `ANTHROPIC_STUB`, `QUERIES_STUB`, `DETERMINISTIC_SQL_STUB`, `CHAT_RUNTIME_STUB`, `CHAT_QUALITY_STUB`, `ANSWER_SANITY_STUB`, `SERVER_LOG_STUB`, `PERF_TRACE_STUB`, `ZERO_LLM_GUARD_STUB`) is reused; the `CHAT_RUNTIME_STUB` is extended with a `__setSynthesisStreamImpl` setter that returns an async iterator yielding configurable chunks (defaulting to ≥ 3 chunks whose concatenation equals the buffered answer string). The harness then runs two assertions:
   - **JSON-compatibility assertion (resolves round-2 High and round-3 Medium #1):** invokes the route handler's exported `POST` with **no** `Accept: text/event-stream` (e.g. `Accept: application/json` or omitted) for a fixture request and asserts (a) `response.headers.get("content-type")` starts with `application/json`, (b) `await response.json()` returns an object that contains every `ChatApiResponse` field actually read by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs:42`. The asserted field set MUST cover all of: `adequacyGrade` (or fallback `responseGrade`), `adequacyReason` (or fallback `gradeReason`), `answer` (or fallback `error`), `answerReasoning`, `generationNotes`, `generationSource`, `model`, `requestId`, `result.rowCount`, `result.rows` (array), `runtime.completeness.warnings` (array), `runtime.questionType`, `runtime.resolution.status`, `runtime.resolution.needsClarification`, `runtime.resolution.selectedDriverNumbers`, `runtime.resolution.selectedSession.sessionKey`, and `sql`. Test asserts each path is present (`!== undefined`, but `null` is allowed where the consumer applies a `?? null` coalesce) so that the entire surface read by `chat-health-check.mjs:172-191` is contractually preserved for non-streaming callers — proving the "no consumer migration required" claim.
   - **Streaming assertion:** invokes the same `POST` with `Accept: text/event-stream` for a multi-paragraph fixture and asserts `response.body instanceof ReadableStream` and `response.headers.get("content-type")` includes `text/event-stream`. Reads the body via `response.body.getReader()` in a loop, decodes with `TextDecoder`, parses SSE frames, and asserts (a) the count of distinct `delta` frames is **≥ 3**, (b) exactly one terminal `final` frame is emitted, and (c) the concatenated `delta.text` values equal `final.payload.answer` (correctness, not just chunkiness).
5. Add `web/scripts/tests/streaming-ui.test.mjs` as the deterministic UI gate (resolves round-1 Medium #1). The harness reads `web/src/components/chat/streamingConsumer.ts` via `node:fs/promises.readFile`, transpiles it with `ts.transpileModule` (`module: ESNext`, `target: ES2022`, `esModuleInterop: true`) from the existing `typescript` devDependency, writes the output to a `mkdtemp`'d directory, and `await import(...)`s it. No `@/lib/*` rewrites or stubs are required because `streamingConsumer.ts` only imports a type from `@/lib/chatTypes` (erased at transpile time). The test then drives `consumeChatStream` against a stub `Response` whose body is a `ReadableStream` constructed via `new ReadableStream({ start(controller) { ... } })` emitting three queued `data: {"type":"delta","text":"<chunk>"}\n\n` frames with explicit `await` between enqueues, then a `data: {"type":"final","payload":{...}}\n\n` frame, then `controller.close()`. Asserts that after each `delta` is enqueued and flushed, the captured `onDelta(cumulativeText, chunkText)` invocations expose the **cumulative concatenation** of delta texts so far — i.e. the UI updates incrementally rather than only after the stream closes — and that on the `final` frame `onFinal` is invoked exactly once with the embedded `ChatApiResponse` payload. Test placement under `web/scripts/tests/*.test.mjs` is automatically picked up by `npm run test:grading` (`web/package.json:10`) — no script change needed.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatWorkspace.tsx`
- `web/src/components/chat/streamingConsumer.ts` (new)
- `web/scripts/tests/streaming-synthesis.test.mjs` (new)
- `web/scripts/tests/streaming-ui.test.mjs` (new)

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
- [ ] `streaming-synthesis.test.mjs`'s **JSON-compatibility assertion** passes: when invoked without `Accept: text/event-stream`, the `POST` handler returns `Content-Type: application/json` and a JSON body whose every key path consumed by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs:42` is present (each `!== undefined`; `null` permitted where the consumer applies `?? null`). The asserted path set covers: `adequacyGrade`, `adequacyReason`, `answer`, `answerReasoning`, `generationNotes`, `generationSource`, `model`, `requestId`, `result.rowCount`, `result.rows`, `runtime.completeness.warnings`, `runtime.questionType`, `runtime.resolution.status`, `runtime.resolution.needsClarification`, `runtime.resolution.selectedDriverNumbers`, `runtime.resolution.selectedSession.sessionKey`, and `sql`. No consumer migration required.
- [ ] `streaming-synthesis.test.mjs`'s **streaming assertion** passes: when invoked with `Accept: text/event-stream`, `response.body instanceof ReadableStream`, the response emits ≥ 3 distinct `delta` SSE frames before exactly one terminal `final` frame, and the concatenated `delta.text` values equal `final.payload.answer`.
- [ ] `streaming-ui.test.mjs` asserts that the `consumeChatStream` helper exported from `web/src/components/chat/streamingConsumer.ts` invokes its `onDelta(cumulativeText, chunkText)` callback with the cumulative concatenation of delta texts after each delta frame arrives (not only after the stream closes) and invokes `onFinal` exactly once with the embedded `ChatApiResponse` payload. Deterministic gate; no manual verification.
- [ ] Both new tests run under `cd web && npm run test:grading` without any new devDependency, gate-script change, or external service: the harness uses only `node --test`, `node:fs/promises`, `node:os`, `node:path`, and the already-installed `typescript` devDependency (`web/package.json:34`).

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

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Specify a self-contained `node --test` harness for Steps 4-5 that can execute `web/src/app/api/chat/route.ts` and the extracted streaming-consumer helper under the current plain test runner, including any required TS/TSX transpilation plus `@/...` / `next/*` import rewrites or an alternate JS-importable helper target; as written, the gates assume direct source imports that `web/package.json` does not provide.

### Medium
- [x] Expand the JSON-compatibility assertion and matching acceptance criterion to cover every field currently read by `web/scripts/chat-health-check.mjs:172-191`, or narrow the “no consumer migration required” claim; the current minimum list omits live consumer reads such as `answerReasoning`, `model`, `result.rowCount`, `result.rows`, `runtime.completeness.warnings`, `runtime.questionType`, and `runtime.resolution.status`.
- [x] Align `Inputs` and `Changed files expected` with Step 3's optional sibling streaming-helper file, or constrain Step 3 to keep the exported helper inside `ChatWorkspace.tsx`; the current scope list omits one of the plan's own allowed edit targets.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `web/package.json:10` still runs `test:grading` as plain `node --test scripts/tests/*.test.mjs`.
