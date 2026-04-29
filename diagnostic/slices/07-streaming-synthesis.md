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
Stream the synthesis response over the wire as tokens arrive, rather than buffering the full response, and wire the chat UI to forward those tokens into React state via a constrained `onDelta → setMessages(prev => withAssistantText(prev, cumulativeText))` shape that is statically gated. The slice gates three things deterministically: (a) the `/api/chat` route emits SSE delta frames in the streaming order required by the consumer; (b) the `consumeChatStream` helper invokes `onDelta` with cumulative text as each frame arrives; and (c) `ChatWorkspace.tsx` actually wires the helper into React state in the constrained shape (no progressive-DOM runtime gate — see Decisions § Scope of UI gate). Improves perceived latency for long answers.

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
- **Scope of UI gate (resolves round-4 Medium and round-6 Medium).** The streaming claim is gated by **three** deterministic tests, not one. The slice splits the UI gate into a runtime callback-contract gate and a static wiring gate so that a regression in either layer fails CI.
  - **Helper callback contract gate (`streaming-ui.test.mjs`).** Covers the contract of the `consumeChatStream` helper exported from `web/src/components/chat/streamingConsumer.ts`: progressive `onDelta(cumulativeText, chunkText)` invocations for each SSE delta frame, and exactly one `onFinal` invocation with the embedded `ChatApiResponse`. Runtime, transpile-and-import.
  - **Wiring gate (`streaming-ui-wiring.test.mjs`, resolves round-6 Medium, round-7 Medium, and state.md note 68).** A static AST assertion over `web/src/components/chat/ChatWorkspace.tsx` parsed via the already-installed `typescript` devDependency's `ts.createSourceFile(..., ts.ScriptKind.TSX)`. The walker asserts: (1) `consumeChatStream` is named-imported from `./streamingConsumer`; (2) **fetch-wiring** — there is exactly one `CallExpression` whose callee is the identifier `fetch` and whose `arguments[0]` is a string literal (or `NoSubstitutionTemplateLiteral`) with `.text === "/api/chat"`, its `arguments[1]` is an `ObjectLiteralExpression`, and the source text of that options object (projected via `getText(sourceFile)`) contains BOTH the substring `Accept` AND the substring `text/event-stream` (this proves the SSE opt-in header is structurally bound to the `/api/chat` fetch options, not a dead/orphaned constant elsewhere in the file); (3) there is exactly one `CallExpression` whose callee is the identifier `consumeChatStream`; (4) that call's second argument is an `ObjectLiteralExpression`; (5) that object has a `PropertyAssignment` named `onDelta` whose initializer is an `ArrowFunction`; (6) the arrow takes exactly one parameter named `cumulativeText` (Identifier binding, not a destructure or rest); (7) the arrow's body, projected back to source text via `arrow.body.getText(sourceFile)`, contains both the substring `setMessages` and the substring `cumulativeText`. This catches a regression in which someone removes the wiring, renames the parameter, drops `setMessages`, introduces conditional logic that breaks the cumulative-text invariant, OR detaches the `Accept: text/event-stream` header from the `/api/chat` fetch (the round-7 failure mode).
  - **What the wiring gate intentionally does NOT cover.** It is a static structural assertion — it does not run React, render JSX, or observe a real DOM update at runtime. Doing so would require pulling in `@testing-library/react` or `react-test-renderer`, which are not currently devDependencies of `web/package.json` and are outside this slice's scope. Together with `npm run typecheck` (which catches callback signature mismatches), the wiring gate is treated as the slice's "owning UI state-update path" gate per state.md note 68. **The slice therefore claims that the wiring exists in the constrained shape; it does not claim a runtime guarantee that the rendered DOM progressively updates.** Progressive DOM rendering follows from React's standard re-render-on-setState semantics applied to that wired callback contract.
  - **The route producer gate** lives in `streaming-synthesis.test.mjs` (Step 4) — it asserts `≥ 3` distinct delta frames whose concatenation equals the final answer.
- **Streaming-semantics gates (resolves round-8 High #1 + #2 and state.md note 68: "For SSE/streaming slices, require one gate that observes pre-terminal bytes before stream close and one gate that splits a logical frame across multiple `ReadableStream` reads; frame-count-only or whole-frame fixtures do not prove real streaming semantics").** The slice adds two semantics-level guarantees on top of the existing producer / consumer / wiring gates:
  - **Pre-terminal-bytes gate (in `streaming-synthesis.test.mjs`).** A buffered-at-end implementation that produces all `delta` frames synchronously *after* the synthesis finishes would still satisfy a frame-count-only assertion, defeating the slice's "stream over the wire as tokens arrive" goal. To prevent that, the `chatRuntime` stub's streaming-synthesis iterator (`__setSynthesisStreamImpl`) is configured to await between yields using a manually-resolvable barrier the test controls (an array of `{promise, resolve}` deferreds, one per chunk). The test reads `response.body.getReader()` in a loop and records each `read()` result. After the first chunk's deferred is resolved AND the test has performed one `read()` that returned bytes, the test asserts (a) the bytes returned by that `read()` decode to a string containing at least one `data: {"type":"delta",` SSE frame and (b) the bytes returned by that `read()` do NOT contain the substring `"type":"final"`. Only after this pre-terminal observation passes does the test resolve the remaining deferreds, drain the stream, and run the existing concatenation/equality assertions. A buffered-at-end implementation cannot satisfy step (b) because no delta bytes can leave the route until after the producer iterator has finished, by which time the final frame is already enqueued.
  - **Split-frame reconstruction gate (in `streaming-ui.test.mjs`).** A whole-frame fixture in which each `controller.enqueue()` corresponds 1:1 to one complete `data: {...}\n\n` frame does not exercise the helper's cross-read buffering path that real network chunking requires. The test therefore enqueues at least one logical SSE frame across two separate `controller.enqueue()` calls (e.g., enqueue `data: {"type":"delta","te` followed by `xt":"chunkA"}\n\n`), and additionally splits the trailing `\n\n` terminator across two enqueues for a second frame (e.g., enqueue `data: {"type":"delta","text":"chunkB"}\n` followed by `\n`) so that the buffer-flush boundary itself is exercised. The test asserts `onDelta` is invoked exactly once per logical frame (not once per `enqueue()` chunk) and that the `chunkText` argument for each call equals the full reassembled text from the original frame's JSON payload, proving the helper buffers partial reads and only flushes on a complete `\n\n` boundary.
- **Test-harness strategy for Steps 4 and 5 (resolves round-3 High).** Both new tests follow the established self-contained `node --test` pattern used by `web/scripts/tests/skip-repair.test.mjs` and `web/scripts/tests/route-trace.test.mjs`: read the TS source via `node:fs/promises.readFile`, rewrite `@/lib/*` and `next/server` imports to local stub files, transpile with the already-installed `typescript` devDependency via `ts.transpileModule(...)` (`module: ESNext`, `target: ES2022`), write the output to a `mkdtemp`'d directory, and `await import(...)` the resulting `.mjs`. No new devDependency is required — `typescript` and `tsx` are already in `web/package.json:34`. `web/package.json:10` runs `test:grading` as `node --test scripts/tests/*.test.mjs`, so dropping the new files into `scripts/tests/` is sufficient — no script change needed.
  - For Step 4 (`streaming-synthesis.test.mjs`), the harness mirrors `skip-repair.test.mjs:152-209`: rewrite all of `route.ts`'s `next/server`, `@/lib/cache/answerCache`, `@/lib/anthropic`, `@/lib/queries`, `@/lib/deterministicSql`, `@/lib/chatRuntime`, `@/lib/chatQuality`, `@/lib/answerSanity`, `@/lib/serverLog`, `@/lib/perfTrace`, `@/lib/zeroLlmGuard` imports to local `.stub.mjs` files. **Stub-sharing constraint (resolves round-5 Medium):** all stub-module source strings (`NEXT_SERVER_STUB`, `ANTHROPIC_STUB`, `QUERIES_STUB`, `DETERMINISTIC_SQL_STUB`, `CHAT_RUNTIME_STUB`, `CHAT_QUALITY_STUB`, `ANSWER_SANITY_STUB`, `SERVER_LOG_STUB`, `PERF_TRACE_STUB`, `ZERO_LLM_GUARD_STUB`) are declared **inline as string constants inside `streaming-synthesis.test.mjs` itself** — copied from `skip-repair.test.mjs` if needed, but NOT extracted into a shared `web/scripts/tests/fixtures/` directory or any other module. This keeps the slice's edits limited to the two new `*.test.mjs` files listed in `Changed files expected` and avoids touching `skip-repair.test.mjs`. The `chatRuntime` stub returns a fake runtime whose synthesis path emits ≥ 3 token chunks (e.g. `__setBuildChatRuntimeImpl` configures the synthesis iterator to yield three chunks for the streaming assertion); the only delta vs. the existing `skip-repair` stub copy is extending `CHAT_RUNTIME_STUB` to expose a configurable streaming-synthesis iterator. The route is then exercised by constructing a `Request` (`new Request("http://localhost/api/chat", { method: "POST", headers: { "Accept": "...", "content-type": "application/json" }, body: JSON.stringify({ message }) })`) and calling the transpiled `route.POST(req)`.
  - For Step 5 (`streaming-ui.test.mjs`), the harness only needs to transpile the new `web/src/components/chat/streamingConsumer.ts` (no `@/...` imports — see Decisions § Helper file location). The test reads it via `readFile`, transpiles with `ts.transpileModule`, writes to a tmp dir, and imports it. The driver constructs a stub `Response` whose body is a `ReadableStream` (built via `new ReadableStream({ start(controller) { ... } })`) emitting queued SSE frames, and asserts the consumer's incremental callbacks. Because the helper file is plain TS with no React, JSX, or browser-only imports, no `@/...` rewrites or DOM stubs are required.

## Steps
1. Switch `web/src/app/api/chat/route.ts` to branch on the request `Accept` header. **JSON path (default, no `Accept: text/event-stream`):** behavior identical to today — return the structured `ChatApiResponse` JSON exactly as currently shaped (no field added or removed). **SSE path** (`Accept` includes `text/event-stream`): return a streaming `Response` with `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store, no-transform`. Body is a `ReadableStream<Uint8Array>` that emits, in order, one or more `data: {"type":"delta","text":"<chunk>"}\n\n` SSE frames as synthesis tokens arrive, then exactly one terminal `data: {"type":"final","payload":<full ChatApiResponse>}\n\n` frame, then closes. **Per-token enqueue requirement (gated by Step 4's pre-terminal-bytes assertion):** the `ReadableStream`'s `start(controller)` body MUST `await` the chatRuntime synthesis iterator one chunk at a time and call `controller.enqueue(encoder.encode(deltaFrame))` per chunk before awaiting the next chunk. It MUST NOT collect all chunks into an array first and enqueue them in one batch at the end, nor enqueue them only after the terminal `final` frame is constructed — doing so would defeat over-the-wire streaming and trip Step 4's pre-terminal-bytes gate. Errors on the SSE path are emitted as a single `data: {"type":"error","payload":<ChatApiResponse-with-error>}\n\n` frame followed by stream close (mirrors the JSON error shape so the UI can fall back to existing error handling).
2. Update `web/src/lib/chatRuntime.ts` synthesis to expose an async iterator (or `ReadableStream`) that yields partial token strings as they are produced, **in addition to** the existing buffered API. The buffered entry point used by the JSON path and by every caller outside this slice MUST remain intact and call-compatible (same exported name, same return shape). The streaming entry point internally uses the same answer-composition logic so that the concatenation of yielded tokens equals the legacy buffered answer for the same inputs.
3. Create `web/src/components/chat/streamingConsumer.ts` exporting a plain-TS helper `consumeChatStream(response: Response, callbacks: { onDelta(cumulativeText: string, chunkText: string): void; onFinal(payload: ChatApiResponse): void; onError(payload: ChatApiResponse): void }): Promise<void>`. The helper reads `response.body` via `getReader()` + `TextDecoder`, buffers partial SSE frames across reads, parses `data: {...}\n\n` frames, and invokes the matching callback for each frame. The helper has NO React, JSX, browser-DOM, or `@/lib/*` imports — it imports only the `ChatApiResponse` type from `@/lib/chatTypes` (a type-only import that is erased at transpile time, so the deterministic UI gate's transpile step does not need to resolve it). Then update `web/src/components/chat/ChatWorkspace.tsx` `send()` to set `Accept: text/event-stream` on the `/api/chat` fetch and call `consumeChatStream(response, { onDelta, onFinal, onError })`. The `onDelta` callback is constrained to a single mechanical line that forwards `cumulativeText` to React state — the implementation MUST be of the shape `onDelta: (cumulativeText) => setMessages(prev => withAssistantText(prev, cumulativeText))` (or equivalent direct `setX(cumulativeText)` for whichever state slice holds the assistant text). No conditional logic, no chunk concatenation in the component (the helper already cumulates), no awaiting of the full response. React's standard re-render-on-setState semantics then drive progressive UI updates; the slice does not separately gate the rendered DOM (see Decisions § Scope of UI gate). The `onFinal` callback takes the embedded `ChatApiResponse` payload and runs the existing post-response logic unchanged (`mapChatApiResponseToParts`, `deriveResolvedContext`, `setResolved`, `setComposerCtx`, `lastResolved` patch, then `setLoading(false)`). The `onError` callback mirrors the current error branch using `payload.error` / `payload.requestId`.
4. Add `web/scripts/tests/streaming-synthesis.test.mjs` that builds a self-contained route harness following the pattern in `web/scripts/tests/skip-repair.test.mjs:152-209` (read TS source, rewrite `next/server` and every `@/lib/*` import to local stub `.mjs` files, transpile with `ts.transpileModule` from the already-installed `typescript` devDependency, write outputs to a `mkdtemp`'d directory, `await import(...)` the resulting `.mjs`). The stub-module string constants (`NEXT_SERVER_STUB`, `ANTHROPIC_STUB`, `QUERIES_STUB`, `DETERMINISTIC_SQL_STUB`, `CHAT_RUNTIME_STUB`, `CHAT_QUALITY_STUB`, `ANSWER_SANITY_STUB`, `SERVER_LOG_STUB`, `PERF_TRACE_STUB`, `ZERO_LLM_GUARD_STUB`) are **declared inline inside `streaming-synthesis.test.mjs`** (copied from `skip-repair.test.mjs` where applicable) — NOT extracted into a shared `web/scripts/tests/fixtures/` directory and NOT imported from `skip-repair.test.mjs`, so this slice's only test-file edits are the two new `*.test.mjs` files in `Changed files expected`. The `CHAT_RUNTIME_STUB` is extended with a `__setSynthesisStreamImpl` setter that returns an async iterator yielding configurable chunks (defaulting to ≥ 3 chunks whose concatenation equals the buffered answer string). The harness then runs two assertions:
   - **JSON-compatibility assertion (resolves round-2 High and round-3 Medium #1):** invokes the route handler's exported `POST` with **no** `Accept: text/event-stream` (e.g. `Accept: application/json` or omitted) for a fixture request and asserts (a) `response.headers.get("content-type")` starts with `application/json`, (b) `await response.json()` returns an object that contains every `ChatApiResponse` field actually read by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs:42`. The asserted field set MUST cover all of: `adequacyGrade` (or fallback `responseGrade`), `adequacyReason` (or fallback `gradeReason`), `answer` (or fallback `error`), `answerReasoning`, `generationNotes`, `generationSource`, `model`, `requestId`, `result.rowCount`, `result.rows` (array), `runtime.completeness.warnings` (array), `runtime.questionType`, `runtime.resolution.status`, `runtime.resolution.needsClarification`, `runtime.resolution.selectedDriverNumbers`, `runtime.resolution.selectedSession.sessionKey`, and `sql`. Test asserts each path is present (`!== undefined`, but `null` is allowed where the consumer applies a `?? null` coalesce) so that the entire surface read by `chat-health-check.mjs:172-191` is contractually preserved for non-streaming callers — proving the "no consumer migration required" claim.
   - **Streaming assertion:** invokes the same `POST` with `Accept: text/event-stream` for a multi-paragraph fixture and asserts `response.body instanceof ReadableStream` and `response.headers.get("content-type")` includes `text/event-stream`. Reads the body via `response.body.getReader()` in a loop, decodes with `TextDecoder`, parses SSE frames, and asserts (a) the count of distinct `delta` frames is **≥ 3**, (b) exactly one terminal `final` frame is emitted, and (c) the concatenated `delta.text` values equal `final.payload.answer` (correctness, not just chunkiness).
   - **Pre-terminal-bytes assertion (resolves round-8 High #1 and state.md note 68):** before running the streaming assertion above, the test installs a stub `chatRuntime` synthesis iterator that awaits between yields on test-controlled deferreds. Specifically, the test creates an array of three deferred objects `[{promise, resolve}, ...]` and configures `__setSynthesisStreamImpl` to yield `chunk_i` only after `deferreds[i].promise` resolves. The test then calls `route.POST(req)` with `Accept: text/event-stream`, obtains `reader = response.body.getReader()`, resolves only `deferreds[0].resolve()`, and `await reader.read()`. Asserts the returned `value` decodes (via `TextDecoder`) to a string that (a) contains the substring `data: {"type":"delta",` (proving at least one delta frame's bytes have been observed) AND (b) does NOT contain the substring `"type":"final"` (proving the terminal frame has not yet been emitted, ergo the route is not buffer-at-end). The test then resolves `deferreds[1]` and `deferreds[2]` and drains the remainder of the stream to run the count/equality assertions. A buffered-at-end implementation cannot satisfy (b) because no delta bytes can be enqueued before the producer iterator completes, by which time the final frame has already been enqueued in the same flush.
5. Add `web/scripts/tests/streaming-ui.test.mjs` as the **helper callback-contract gate** (resolves round-1 Medium #1). The harness reads `web/src/components/chat/streamingConsumer.ts` via `node:fs/promises.readFile`, transpiles it with `ts.transpileModule` (`module: ESNext`, `target: ES2022`, `esModuleInterop: true`) from the existing `typescript` devDependency, writes the output to a `mkdtemp`'d directory, and `await import(...)`s it. No `@/lib/*` rewrites or stubs are required because `streamingConsumer.ts` only imports a type from `@/lib/chatTypes` (erased at transpile time). The test then drives `consumeChatStream` against a stub `Response` whose body is a `ReadableStream` constructed via `new ReadableStream({ start(controller) { ... } })`. The stream MUST exercise both whole-frame and split-frame chunking patterns described below so that the helper's cross-read buffering is gated, not merely its happy-path frame parsing.
   - **Whole-frame happy path.** Enqueue at least one complete `data: {"type":"delta","text":"chunkA"}\n\n` frame as a single `controller.enqueue(encoder.encode(frame))` call (this exercises the simple flush-on-`\n\n` path).
   - **Split-frame reconstruction (resolves round-8 High #2 and state.md note 68).** Enqueue at least one logical SSE delta frame as TWO separate `controller.enqueue()` calls that bisect the JSON payload — for example, first `controller.enqueue(encoder.encode("data: {\"type\":\"delta\",\"te"))` then `controller.enqueue(encoder.encode("xt\":\"chunkB\"}\n\n"))`. Additionally, enqueue at least one frame whose terminator is bisected — first `controller.enqueue(encoder.encode("data: {\"type\":\"delta\",\"text\":\"chunkC\"}\n"))` then `controller.enqueue(encoder.encode("\n"))` — so the buffer-flush boundary itself is exercised. Between bisected-frame `enqueue()` calls, `await` a microtask (e.g. `await new Promise((r) => setTimeout(r, 0))`) so the helper's `read()` loop is forced to return mid-frame. After the partial enqueue but BEFORE the completing enqueue, assert that `onDelta` has NOT yet been invoked for the in-flight frame (i.e. the helper has buffered the partial bytes rather than emitting a malformed frame). After the completing enqueue and a microtask drain, assert that `onDelta` has been invoked exactly once for the bisected frame and that the `chunkText` argument equals the original frame's full reassembled JSON `text` field (`"chunkB"` and `"chunkC"` respectively). This proves the helper buffers across `read()` calls and only flushes on a complete `\n\n` boundary.
   - **Final-frame closure.** After the delta frames are drained, enqueue a `data: {"type":"final","payload":{...}}\n\n` frame, then `controller.close()`.
   The test then asserts that, taken across both whole-frame and split-frame fixtures, the captured `onDelta(cumulativeText, chunkText)` invocations expose the **cumulative concatenation** of delta texts after each frame is parsed (cumulative state is incremental, not delivered only after stream close), the count of `onDelta` invocations equals the count of logical delta frames (NOT the count of `enqueue()` calls), and on the `final` frame `onFinal` is invoked exactly once with the embedded `ChatApiResponse` payload. Test placement under `web/scripts/tests/*.test.mjs` is automatically picked up by `npm run test:grading` (`web/package.json:10`) — no script change needed.
6. Add `web/scripts/tests/streaming-ui-wiring.test.mjs` as the **static wiring gate over the owning UI state-update path** (resolves round-6 Medium and state.md note 68: "When a slice claims progressive UI streaming, require a deterministic gate over the owning UI state-update path, not only over a helper parser callback contract"). The harness reads `web/src/components/chat/ChatWorkspace.tsx` via `node:fs/promises.readFile` and parses it with the already-installed `typescript` devDependency: `ts.createSourceFile("ChatWorkspace.tsx", source, ts.ScriptTarget.ES2022, /*setParentNodes*/ true, ts.ScriptKind.TSX)`. No transpilation or `await import` step is required because the assertions are purely structural over the AST. A recursive `ts.forEachChild` walker collects:
   - **Import assertion.** Iterate `sourceFile.statements`. Find an `ImportDeclaration` whose `moduleSpecifier.text === "./streamingConsumer"` and whose `importClause.namedBindings` is a `NamedImports` containing an element whose `name.text === "consumeChatStream"`. Fail if absent.
   - **Fetch-wiring assertion (resolves round-7 Medium).** Walk all `CallExpression` descendants and collect every call whose `expression` is an `Identifier` with `text === "fetch"`. Among those, locate the call(s) whose `arguments[0]` is a `StringLiteral` or `NoSubstitutionTemplateLiteral` with `.text === "/api/chat"`. Assert exactly one such call exists; bind it as `apiChatFetchCall`. Then assert `apiChatFetchCall.arguments[1]` exists and is an `ObjectLiteralExpression`, and that the source text of that options argument projected via `apiChatFetchCall.arguments[1].getText(sourceFile)` contains BOTH the substring `Accept` AND the substring `text/event-stream`. This proves the SSE opt-in header is structurally attached to the `/api/chat` request options — a free-floating `text/event-stream` constant elsewhere in the file fails this gate, satisfying state.md note 68's "owning UI state-update path" requirement at the request layer. (This subsumes and replaces the previous literal-only Accept-header check.)
   - **`consumeChatStream` call assertion.** Walk all descendants and collect every `CallExpression` whose `expression` is an `Identifier` with `text === "consumeChatStream"`. Assert exactly one such call exists. Bind its `arguments[1]` (the callbacks object).
   - **Callbacks-object assertion.** Assert `arguments[1]` is an `ObjectLiteralExpression`. Among its `properties`, find a `PropertyAssignment` whose `name` is an `Identifier` with `text === "onDelta"`. Fail if absent.
   - **`onDelta` shape assertion.** Assert the `onDelta` property's `initializer` is an `ArrowFunction`. Assert it has exactly **one** parameter, the parameter's `name` is an `Identifier` (not a binding pattern), and its `text === "cumulativeText"`. Project the body back to source text via `arrowFn.body.getText(sourceFile)` and assert the body string contains the substring `setMessages` AND the substring `cumulativeText`. Fail if any condition is unmet.
   The harness uses only `node --test`, `node:fs/promises`, `node:path`, `node:assert/strict`, and the existing `typescript` devDependency — no new devDependency, no React renderer, no DOM stub. Test placement under `web/scripts/tests/*.test.mjs` is automatically picked up by `npm run test:grading` (`web/package.json:10`) — no script change needed.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatWorkspace.tsx`
- `web/src/components/chat/streamingConsumer.ts` (new)
- `web/scripts/tests/streaming-synthesis.test.mjs` (new)
- `web/scripts/tests/streaming-ui.test.mjs` (new)
- `web/scripts/tests/streaming-ui-wiring.test.mjs` (new)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```
(`test:grading` is `node --test scripts/tests/*.test.mjs`, so all three new `*.test.mjs` files (`streaming-synthesis.test.mjs`, `streaming-ui.test.mjs`, `streaming-ui-wiring.test.mjs`) are picked up automatically — no script change needed.)

## Acceptance criteria
- [ ] `streaming-synthesis.test.mjs`'s **JSON-compatibility assertion** passes: when invoked without `Accept: text/event-stream`, the `POST` handler returns `Content-Type: application/json` and a JSON body whose every key path consumed by `chat-health-check.mjs:172-191` and `session-propagation.test.mjs:42` is present (each `!== undefined`; `null` permitted where the consumer applies `?? null`). The asserted path set covers: `adequacyGrade`, `adequacyReason`, `answer`, `answerReasoning`, `generationNotes`, `generationSource`, `model`, `requestId`, `result.rowCount`, `result.rows`, `runtime.completeness.warnings`, `runtime.questionType`, `runtime.resolution.status`, `runtime.resolution.needsClarification`, `runtime.resolution.selectedDriverNumbers`, `runtime.resolution.selectedSession.sessionKey`, and `sql`. No consumer migration required.
- [ ] `streaming-synthesis.test.mjs`'s **streaming assertion** passes: when invoked with `Accept: text/event-stream`, `response.body instanceof ReadableStream`, the response emits ≥ 3 distinct `delta` SSE frames before exactly one terminal `final` frame, and the concatenated `delta.text` values equal `final.payload.answer`.
- [ ] `streaming-synthesis.test.mjs`'s **pre-terminal-bytes assertion** passes (resolves round-8 High #1, state.md note 68): with the `chatRuntime` synthesis stub configured to await test-controlled deferreds between yields, after resolving only the first chunk's deferred, the first `await reader.read()` returns bytes whose decoded text contains `data: {"type":"delta",` AND does NOT contain `"type":"final"`, proving the SSE path emits delta bytes over the wire BEFORE the producer iterator finishes (no buffer-at-end implementation can satisfy this).
- [ ] `streaming-ui.test.mjs` (helper callback-contract gate) asserts that the `consumeChatStream` helper exported from `web/src/components/chat/streamingConsumer.ts` invokes its `onDelta(cumulativeText, chunkText)` callback with the cumulative concatenation of delta texts after each delta frame arrives (not only after the stream closes) and invokes `onFinal` exactly once with the embedded `ChatApiResponse` payload.
- [ ] `streaming-ui.test.mjs`'s **split-frame reconstruction assertion** passes (resolves round-8 High #2, state.md note 68): the test fixture enqueues at least one delta SSE frame whose JSON payload is bisected across two `controller.enqueue()` calls AND at least one delta frame whose `\n\n` terminator is bisected; before the completing enqueue, `onDelta` has NOT been invoked for the in-flight frame; after the completing enqueue and a microtask drain, `onDelta` has been invoked exactly once for that frame with the correctly reassembled `chunkText`; total `onDelta` call count equals the count of logical delta frames (not the count of `enqueue()` calls), proving the helper buffers across reads and flushes only on `\n\n`.
- [ ] `streaming-ui-wiring.test.mjs` (static wiring gate over the owning UI state-update path, resolves round-6 Medium, round-7 Medium, and state.md note 68) asserts via `ts.createSourceFile(..., ts.ScriptKind.TSX)` AST inspection of `web/src/components/chat/ChatWorkspace.tsx` that ALL of the following hold simultaneously, failing if any single condition is unmet: (1) `consumeChatStream` is named-imported from `./streamingConsumer`; (2) **fetch-wiring**: there is exactly one `CallExpression` whose callee is the identifier `fetch` and whose first argument is a string literal (or `NoSubstitutionTemplateLiteral`) with `.text === "/api/chat"`, its second argument is an `ObjectLiteralExpression`, and the source text of that options object (via `arguments[1].getText(sourceFile)`) contains both the substring `Accept` and the substring `text/event-stream` (proves the SSE opt-in header is structurally bound to the `/api/chat` request options, not a dead/orphaned constant elsewhere in the file); (3) there is exactly one `CallExpression` whose callee is the identifier `consumeChatStream`; (4) that call's second argument is an `ObjectLiteralExpression` containing a `PropertyAssignment` named `onDelta`; (5) the `onDelta` initializer is an `ArrowFunction` with exactly one parameter, an `Identifier`-bound parameter named `cumulativeText`; (6) the arrow's body source text (via `body.getText(sourceFile)`) contains both `setMessages` and `cumulativeText`. **Scope note:** this is a static structural assertion, not a runtime React render — the slice does not claim a runtime guarantee that the rendered DOM progressively updates, but it does deterministically gate the wiring shape so a regression in the owning state-update path (including detaching `Accept: text/event-stream` from the `/api/chat` fetch) cannot pass CI. See Decisions § Scope of UI gate.
- [ ] All three new tests (`streaming-synthesis.test.mjs`, `streaming-ui.test.mjs`, `streaming-ui-wiring.test.mjs`) run under `cd web && npm run test:grading` without any new devDependency, gate-script change, or external service: the harnesses use only `node --test`, `node:fs/promises`, `node:os`, `node:path`, `node:assert/strict`, and the already-installed `typescript` devDependency (`web/package.json:34`).

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

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Add a deterministic gate that exercises the actual `ChatWorkspace.tsx` `onDelta` wiring, or narrow Step 3 / the acceptance criteria so the slice no longer claims the UI progressively re-renders streamed assistant text; the current `streaming-ui.test.mjs` only proves the helper callback contract, so a broken state-update path in `ChatWorkspace.tsx` would still pass (`diagnostic/slices/07-streaming-synthesis.md:39`, `diagnostic/slices/07-streaming-synthesis.md:41`, `diagnostic/slices/07-streaming-synthesis.md:43`, `diagnostic/slices/07-streaming-synthesis.md:57`).

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `cd web && npm run build` before `cd web && npm run typecheck` still matches the current auditor note for web slices.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High

### Medium
- [x] Align `Changed files expected` with the allowed Step 4 harness implementation, or constrain Step 4 to avoid shared fixture edits; the plan currently allows copying the existing stubs or sharing them via a new/existing `web/scripts/tests/fixtures/` helper, but only lists the two new `*.test.mjs` files as in-scope test changes (`diagnostic/slices/07-streaming-synthesis.md:36`, `diagnostic/slices/07-streaming-synthesis.md:44`, `diagnostic/slices/07-streaming-synthesis.md:49`).

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `diagnostic/_state.md:44-54` still requires transport-change slices to enumerate legacy consumers and progressive-UI slices to gate the owning state-update path; this revision satisfies those protocol notes.

## Plan-audit verdict (round 6)

**Status: REVISE**

### High

### Medium
- [x] Either add a deterministic gate over `ChatWorkspace.tsx`'s actual `onDelta` state-update wiring, or narrow Step 3 / the Goal so the slice no longer claims the client progressively renders streamed assistant text; the current plan still requires `ChatWorkspace.tsx` to push cumulative text into React state, but the only gate remains the helper-level callback contract (`diagnostic/slices/07-streaming-synthesis.md:39`, `diagnostic/slices/07-streaming-synthesis.md:41`, `diagnostic/slices/07-streaming-synthesis.md:43`, `diagnostic/slices/07-streaming-synthesis.md:57`).

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.

## Plan-audit verdict (round 7)

**Status: REVISE**

### High

### Medium
- [x] Strengthen `streaming-ui-wiring.test.mjs` so it proves `Accept: text/event-stream` is attached to the `/api/chat` fetch request (or the specific request options passed on the `consumeChatStream` path), not merely that the string literal exists somewhere in `ChatWorkspace.tsx`; the current literal-only assertion can pass with a dead/orphaned constant and does not satisfy the deterministic owning-wiring gate required by `diagnostic/_state.md:68`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.

## Plan-audit verdict (round 8)

**Status: REVISE**

### High
- [x] Strengthen `streaming-synthesis.test.mjs` so it proves the SSE path yields observable body data before the terminal frame / stream close, not merely that the fully collected body contains `>= 3` `delta` events; a buffered-at-end implementation still satisfies the current gate while missing the slice’s “stream over the wire as tokens arrive” goal (`diagnostic/slices/07-streaming-synthesis.md:38`, `diagnostic/slices/07-streaming-synthesis.md:49`, `diagnostic/slices/07-streaming-synthesis.md:81`).
- [x] Extend `streaming-ui.test.mjs` to split at least one `data: {...}\\n\\n` SSE frame across multiple `ReadableStream` reads and assert `consumeChatStream` reconstructs it correctly; the current whole-frame fixture does not gate the buffering-across-reads behavior Step 3 requires for real network chunking (`diagnostic/slices/07-streaming-synthesis.md:46`, `diagnostic/slices/07-streaming-synthesis.md:50`, `diagnostic/slices/07-streaming-synthesis.md:82`).

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
