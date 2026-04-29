---
slice_id: 07-streaming-synthesis-client-wiring
phase: 7
status: pending_plan_audit
owner: claude
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T21:35:00-04:00
---

## Goal
Wire the chat client to opt into the SSE streaming response added by `07-streaming-synthesis-route-sse`. `ChatWorkspace.tsx` sends `Accept: text/event-stream` on chat requests, inserts the placeholder assistant message into conversation state BEFORE consuming the stream so progressive chunks can patch a real message, and includes a graceful JSON fallback if the server doesn't honor the SSE branch (defensive — covers older deploys / proxies that strip the header).

## Inputs
- `web/src/components/chat/ChatWorkspace.tsx` — current chat dispatch site. Today's POST already returns JSON; we add a shared helper that handles both response types.
- `diagnostic/_state.md`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/07-streaming-synthesis.md` — predecessor's round-9, round-10 audit verdicts catalog the client-state-shape concerns (`patchActiveConversation` vs `setMessages`, ordering of placeholder insertion vs stream consumption).
- `diagnostic/slices/07-streaming-synthesis-route-sse.md` — sibling slice that defines the SSE frame contract this client consumes.

## Required services / env
- None at author time. Tests use `fetch` mocking with a fixed response stream; no real server.

## Steps
1. **Add `web/src/lib/chat/consumeChatStream.ts`** — a transport-agnostic helper that takes a `fetch` Response and yields the parsed `ChatApiResponse` regardless of whether the server returned SSE or JSON:
   ```ts
   import type { ChatApiResponse } from "@/lib/chatTypes";

   export type ConsumeChatStreamHooks = {
     onAnswerDelta?(text: string): void;
     onReasoningDelta?(text: string): void;
   };

   export async function consumeChatStream(
     response: Response,
     hooks: ConsumeChatStreamHooks
   ): Promise<ChatApiResponse>
   ```
   - The return type is the existing `ChatApiResponse` from `web/src/lib/chatTypes.ts` (covers `requestId`, `answer`, `sql`, `generationSource`, `model`, `generationNotes`, `answerReasoning`, `adequacyGrade`, `adequacyReason`, `responseGrade`, `gradeReason`, `result`, `runtime`, etc.). Reusing the existing type keeps the typecheck gate meaningful end-to-end.
   - If `response.headers.get("content-type")?.startsWith("text/event-stream")`: parse SSE per the route's documented frame contract. For each `answer_delta`/`reasoning_delta` frame, fire the corresponding hook with the text. On `final`, return the parsed JSON payload (cast to `ChatApiResponse`). On `error`, throw with the frame's message.
   - Otherwise (server returned JSON either because SSE not supported or proxy stripped headers): `await response.json()` (typed as `ChatApiResponse`), fire `onAnswerDelta(answer)` with the entire answer string, then return the JSON. (Graceful degradation: client UX still works without progressive updates.)
2. **Add `web/src/lib/chat/sendChatMessage.ts`** — a pure, hook-free helper that owns the placeholder-first ordering, fetch, stream consumption, and final replacement / error replacement logic. Extracting this from `ChatWorkspace.tsx` is what makes the integration assertions testable without rendering a React component (see Step 4). Signature:
   ```ts
   export type SendChatMessageDeps = {
     fetchImpl?: typeof fetch; // override for tests; defaults to global fetch
     newId(): string;
     patchActiveConversation(updater: (c: Conversation) => Conversation): void;
     // ...any other setter dependencies the body needs (e.g. setResolved, setComposerCtx)
   };

   export async function sendChatMessage(
     args: { text: string; snapshotAtSend: ComposerContext; assistantTime: string; placeholderId: string },
     deps: SendChatMessageDeps
   ): Promise<void>
   ```
   - The helper inserts the placeholder assistant message FIRST (via `deps.patchActiveConversation`) before issuing the fetch, then calls `consumeChatStream`. Each `onAnswerDelta` invocation patches the placeholder's parts by id (NOT by index). On resolve, the helper replaces the placeholder with the finalized assistant message via the same `patchActiveConversation` path. On reject, it replaces the placeholder with the error message. (`patchActiveConversation` is the existing setter at `ChatWorkspace.tsx:87` — the helper accepts it as a plain function ref, no React context required.)
3. **Update `web/src/components/chat/ChatWorkspace.tsx`**:
   - Add `Accept: text/event-stream` alongside `content-type: application/json` in the chat POST headers (the helper from Step 2 owns this).
   - Replace the inline `try { fetch(...) ... } catch { ... } finally { setLoading(false) }` block in the existing `handleSubmit` callback with a call to `sendChatMessage(...)`, passing `patchActiveConversation`, `setResolved`, `setComposerCtx`, and a generated `placeholderId` as deps. The `useCallback` wrapper, `setLoading` toggling, and user-message insertion stay in the component (only the post-user-message work moves into the helper).
   - Confirm the placeholder lookup happens by id (not index) so reorderings inside `messages` don't corrupt the stream patching.
4. **Test** at `web/scripts/tests/streaming-synthesis-client.test.mjs` — Node `node:test` runner, transpile-only via `typescript`, no React rendering required:
   - **Helper unit tests** for `consumeChatStream`: build synthetic `Response` objects (SSE body via `ReadableStream` + `text/event-stream` content-type; JSON body via `Response.json(...)`-style stub). Assert: SSE path fires `onAnswerDelta` for each `answer_delta` frame in order, fires `onReasoningDelta` for `reasoning_delta`, returns the `final` payload as `ChatApiResponse`, and throws when an `error` frame is received. JSON path fires `onAnswerDelta` exactly once with the full answer string, then returns the JSON unchanged.
   - **Integration tests** for `sendChatMessage` (the Step-2 pure helper, NOT ChatWorkspace.tsx itself): pass an in-memory `patchActiveConversation` spy that mutates a local `Conversation` object, an injected `fetchImpl` returning a synthetic SSE Response, and a fixed `newId`. Assert: (a) placeholder is inserted into `messages` BEFORE the first delta arrives (verified by sequencing the spy's call order against the SSE body's chunks); (b) deltas patch the placeholder by id even after a no-op reorder of the messages list mid-stream; (c) on `final`, the helper replaces the placeholder (same id) with the finalized assistant message; (d) when the synthetic Response throws mid-stream, the helper replaces the placeholder with an error message and never leaves it in streaming state. (Because `sendChatMessage` is a plain async function, none of these assertions need a React renderer.)
   - The existing route-harness pattern at `web/scripts/tests/answer-cache.test.mjs` (and similar) is NOT applicable here — those tests transpile `route.ts` together with a sandbox of `@/lib/*` stubs and call it as a function, which is heavier than what's needed for these pure client helpers. Use the same `node:test` + `typescript` transpile mechanism, but because `consumeChatStream.ts` and `sendChatMessage.ts` only need `@/lib/chatTypes` as a TYPE-ONLY import (`import type { ... }`), TypeScript's import-elision drops it at strip-time; no `@/lib/*` runtime stubs are required. (This addresses `_state.md` Note #6 explicitly: every `@/lib/*` import in the modules under test is type-only and therefore elided after transpile.)
   - The implementer must verify before adding new value imports: if any later step needs a runtime `@/lib/*` import, add a stub for it in the test file rather than relying on transpile alone.

## Changed files expected
- `web/src/lib/chat/consumeChatStream.ts` (new — transport-agnostic SSE/JSON helper).
- `web/src/lib/chat/sendChatMessage.ts` (new — pure async helper extracted from `ChatWorkspace.tsx`'s send block; owns placeholder-first ordering, fetch, stream consumption, final/error replacement).
- `web/src/components/chat/ChatWorkspace.tsx` (additive + extraction: `Accept` header, replace inline send body with `sendChatMessage(...)` call, keep `useCallback` wrapper and `setLoading` toggling in component).
- `web/scripts/tests/streaming-synthesis-client.test.mjs` (new — covers `consumeChatStream` unit + `sendChatMessage` integration).
- `diagnostic/slices/07-streaming-synthesis-client-wiring.md` (frontmatter + slice-completion note).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chat/consumeChatStream.ts` exists, returns `Promise<ChatApiResponse>`, and handles both SSE and JSON `fetch` responses, exposing the documented hooks API.
- [ ] `web/src/lib/chat/sendChatMessage.ts` exists as a pure async function (no React hooks) and owns the placeholder-first ordering: on invocation it inserts the placeholder via the injected `patchActiveConversation` BEFORE awaiting the fetch, patches by id during deltas, and replaces by id on final/error.
- [ ] `ChatWorkspace.tsx` sends `Accept: text/event-stream`, delegates the post-user-message work to `sendChatMessage(...)`, and keeps `setLoading` / `useCallback` in-component.
- [ ] Graceful JSON fallback: when the server returns JSON instead of SSE, `consumeChatStream` still fires `onAnswerDelta(answer)` once with the full string and returns the same `ChatApiResponse` shape; `sendChatMessage`'s placeholder UX still completes successfully.
- [ ] Tests cover: SSE path with multiple deltas, JSON fallback path, error frame mid-stream, error thrown mid-stream replaces placeholder (no leftover streaming state), placeholder-id resilience to message-list reordering — all asserted against `sendChatMessage` and `consumeChatStream` directly without React rendering.
- [ ] All 3 gates pass.

## Out of scope
- Any change to `web/src/app/api/chat/route.ts` or `web/src/lib/anthropic.ts` (covered by sibling slices).
- Re-architecting `patchActiveConversation` or the `setStore` state shape (use the existing setter as-is).
- Visual / animation polish for the streaming UX (purely client-side functional wiring).

## Risk / rollback
- Risk: a proxy strips the `Accept` header; server returns JSON; helper's fallback path triggers and the user sees a single delta-then-finalize rather than progressive updates. **Mitigation:** that's the intentional graceful-degradation path; UX is degraded but functional.
- Risk: placeholder inserted but `consumeChatStream` rejects before any delta; placeholder stays in `streaming` state. **Mitigation:** error-path test case asserts the placeholder is replaced by an error message, not left in streaming state.
- Rollback: `git revert` removes the `Accept` header and helper; client falls back to today's JSON-only path.

## Slice-completion note
(filled by claude implementer)

## Audit verdict
(filled by codex)

## Plan-audit verdict (round 1)

**Status: REVISE**
**Auditor: claude-plan-audit (round-1 forced-findings ratchet: not applied — genuine Medium item found)**

### High
_(none)_

### Medium
- [x] Step 3 instructs the implementer to "Test ChatWorkspace integration via the existing harness pattern (see `web/scripts/tests/answer-cache.test.mjs` for the React-component testing approach already in use)" — but `answer-cache.test.mjs` is a route-harness test that transpiles `route.ts` and calls it as a plain function; it has no React rendering capability. `ChatWorkspace.tsx` is a React functional component using `useState`, `useCallback`, and `useEffect` hooks that cannot execute outside a React render context. The acceptance criteria require asserting that the placeholder is inserted BEFORE the first delta, that deltas patch by id, and that an error mid-stream replaces the placeholder — all of which require observing component state mutations. Replace the `answer-cache.test.mjs` reference with a concrete approach: either (a) refactor ChatWorkspace's async send logic into a pure, hook-free helper that can be tested directly (preferred — aligns with the slice's additive-only scope if the helper is extracted as part of Step 1/2) and test that helper with a synthetic `patchActiveConversation` spy, or (b) explicitly scope the ChatWorkspace test assertions to the `consumeChatStream` helper only and drop the "placeholder-id resilience to reordering" AC to the `consumeChatStream` level where it is testable without React rendering.

### Low
- [x] The `consumeChatStream` return type in Step 1 uses `/* + same fields as today's JSON */` as a comment placeholder. Specify the key additional fields explicitly (e.g., `sql`, `generationSource`, `model`, `requestId`) or reference the `RouteOutcome["payload"]` type from `route.ts` so the TypeScript definition is unambiguous and the type-check gate is meaningful.

### Notes (informational only — no action)
- `patchActiveConversation` confirmed at `ChatWorkspace.tsx:87` — no new setter needed.
- All three Prior context paths exist on disk.
- Gate ordering (build → typecheck → test_grading_gate.sh) is correct.
- `## Changed files expected` covers all files touched by the steps; no package.json changes needed.
- The `consumeChatStream` helper has no `@/lib/*` dependencies (pure fetch/Response utility), so the _state.md Note #6 transpilation concern does not apply here.
