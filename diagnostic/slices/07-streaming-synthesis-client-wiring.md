---
slice_id: 07-streaming-synthesis-client-wiring
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T21:13:35Z
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
   - **Runtime imports constraint (load-bearing for Step 4 bundling):** `sendChatMessage.ts` MUST NOT contain any runtime VALUE imports other than `import { consumeChatStream } from "./consumeChatStream"`. All other side-effecting collaborators (id generation, conversation patching, fetch) MUST be injected via `SendChatMessageDeps`. Type-only imports (`import type { ... } from "@/lib/..."`) are allowed because TypeScript's import-elision drops them at strip-time, so they do not appear in the transpiled `.mjs` and do not need stubs in the test tmpdir. This constraint is what allows Step 4's tmpdir to contain only the two transpiled helper files with no `@/lib/*` stub sandbox; if a future change adds a runtime value import (e.g. a finalization helper from `@/lib/chat/...`), the implementer MUST either move it behind a dep or add a corresponding stub in the tmpdir per `_state.md` Note #6.
3. **Update `web/src/components/chat/ChatWorkspace.tsx`**:
   - Add `Accept: text/event-stream` alongside `content-type: application/json` in the chat POST headers (the helper from Step 2 owns this).
   - Replace the inline `try { fetch(...) ... } catch { ... } finally { setLoading(false) }` block in the existing `handleSubmit` callback with a call to `sendChatMessage(...)`, passing `patchActiveConversation`, `setResolved`, `setComposerCtx`, and a generated `placeholderId` as deps. The `useCallback` wrapper, `setLoading` toggling, and user-message insertion stay in the component (only the post-user-message work moves into the helper).
   - Confirm the placeholder lookup happens by id (not index) so reorderings inside `messages` don't corrupt the stream patching.
4. **Test** at `web/scripts/tests/streaming-synthesis-client.test.mjs` — Node `node:test` runner, transpile via `typescript`, bundled into a tmpdir using the same `mkdtemp + writeFile + await import()` pattern as existing tests (e.g. `streaming-synthesis-route.test.mjs:174-228`). No React rendering required.
   - **Tmpdir bundling mechanism** (required so Node can resolve the relative `./consumeChatStream` import that `sendChatMessage.ts` declares as a runtime VALUE import):
     - `mkdtemp` a directory under `__dirname`.
     - Read `consumeChatStream.ts` and `sendChatMessage.ts` from disk, transpile each with `typescript` (target ES2022, module ESNext, JSX preserve unused), and `writeFile` the outputs as `consumeChatStream.mjs` and `sendChatMessage.mjs` in the tmpdir. The relative `./consumeChatStream` import inside `sendChatMessage.ts` will resolve to the sibling `.mjs` after the TS-to-MJS extension rewrite (or the implementer adjusts via a small post-transpile `replaceAll('./consumeChatStream"', './consumeChatStream.mjs"')` step — the existing route test's pattern).
     - `await import(path.join(dir, "sendChatMessage.mjs"))` and `await import(path.join(dir, "consumeChatStream.mjs"))` to load the modules under test.
     - Cleanup: `rm(dir, { recursive: true })` in `after`.
     - **No `@/lib/*` stubs are needed for this slice** because both modules import `@/lib/chatTypes` only as `import type { ... }`, which TypeScript's import-elision drops at strip-time. (This addresses `_state.md` Note #6: the bundling mechanism applies, but the stub sandbox does not. The implementer must verify before adding new value imports — any later runtime `@/lib/*` import requires a stub written into the same tmpdir.)
   - **Helper unit tests** for `consumeChatStream` (loaded from tmpdir): build synthetic `Response` objects (SSE body via `ReadableStream` + `text/event-stream` content-type; JSON body via `Response.json(...)`-style stub). Assert: SSE path fires `onAnswerDelta` for each `answer_delta` frame in order, fires `onReasoningDelta` for `reasoning_delta`, returns the `final` payload as `ChatApiResponse`, and throws when an `error` frame is received. JSON path fires `onAnswerDelta` exactly once with the full answer string, then returns the JSON unchanged.
   - **Integration tests** for `sendChatMessage` (loaded from tmpdir; the Step-2 pure helper, NOT ChatWorkspace.tsx itself): pass an in-memory `patchActiveConversation` spy that mutates a local `Conversation` object, an injected `fetchImpl` returning a synthetic SSE Response, and a fixed `newId`. Assert: (a) placeholder is inserted into `messages` BEFORE the first delta arrives (verified by sequencing the spy's call order against the SSE body's chunks); (b) deltas patch the placeholder by id even after a no-op reorder of the messages list mid-stream; (c) on `final`, the helper replaces the placeholder (same id) with the finalized assistant message; (d) when the synthetic Response throws mid-stream, the helper replaces the placeholder with an error message and never leaves it in streaming state. (Because `sendChatMessage` is a plain async function, none of these assertions need a React renderer.)
   - **ChatWorkspace wiring assertion** (deterministic source-grep gate, in the same `streaming-synthesis-client.test.mjs` file): read `web/src/components/chat/ChatWorkspace.tsx` from disk via `fs/promises.readFile` and assert that the live component is actually wired to the helpers — not just that the helpers exist in isolation:
     - Asserts that the file source contains the substring `sendChatMessage(` (proving Step 3's delegation was performed and the post-user-message work routes through the new helper).
     - Asserts that the file source contains the substring `text/event-stream` (proving the `Accept` header opt-in landed in the live component).
     - Asserts that the file source does NOT contain the inline pattern `fetch("/api/chat"` nor `fetch('/api/chat'` (proving the old inline send block from `handleSubmit` was removed; if the implementer keeps a direct `/api/chat` literal anywhere else, this assertion fires and forces a clean delegation).
     - Rationale: without this gate the slice could pass with `consumeChatStream.ts` and `sendChatMessage.ts` exhaustively unit-tested while the real `ChatWorkspace.tsx` continues to issue its old JSON-only `fetch` and never opts into SSE. This grep-style check is intentionally cheap and structural — it is not a substitute for the helper tests, but a tripwire on the integration seam.
   - The existing route-harness pattern at `web/scripts/tests/answer-cache.test.mjs` (and `streaming-synthesis-route.test.mjs`) is the structural model — same tmpdir bundling, but without the heavy `@/lib/*` stub sandbox those route tests need. (The lighter footprint is sound because of the Step-2 runtime-imports constraint: `sendChatMessage.ts` is restricted to a single relative value import (`./consumeChatStream`), and `consumeChatStream.ts` is itself pure fetch/Response logic with only type-only `@/lib/chatTypes` imports — so the tmpdir contains exactly the two transpiled helper `.mjs` files.) The bundling step itself is non-negotiable: without it, Node will throw `ERR_MODULE_NOT_FOUND` resolving `./consumeChatStream` from the in-tmpdir `sendChatMessage.mjs`.

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
- [ ] Wiring assertion test reads `web/src/components/chat/ChatWorkspace.tsx` source and asserts it contains `sendChatMessage(`, contains `text/event-stream`, and no longer contains a direct `fetch("/api/chat"` / `fetch('/api/chat'` literal — guarding against helper-only refactors that leave the live component issuing JSON-only requests.
- [ ] `sendChatMessage.ts` has no runtime VALUE imports beyond `import { consumeChatStream } from "./consumeChatStream"` (verifiable by inspection of the file's import block; type-only `import type` imports are permitted).
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

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — genuine Medium item found)**

### High
_(none)_

### Medium
- [x] `sendChatMessage.ts` contains a runtime VALUE import `import { consumeChatStream } from "./consumeChatStream"` — not a type-only import. Step 4 describes the test as using the `node:test` + `typescript` transpile mechanism but explicitly dismisses the `answer-cache.test.mjs` bundled-to-tmpdir approach as "NOT applicable here" and "heavier than what's needed." However, all existing tests in this codebase (including `streaming-synthesis-route.test.mjs`) resolve relative module imports by writing transpiled files to a shared `mkdtemp` directory and using `await import()` — without that mechanism, Node cannot resolve `./consumeChatStream` at test runtime and the integration tests will fail at import. Revise Step 4 to either: (a) specify that the test transpiles both `consumeChatStream.ts` and `sendChatMessage.ts` into the same tmpdir using the `mkdtemp + writeFile + await import()` pattern (same mechanism as existing tests, but without the heavy `@/lib/*` stubs since none are needed), or (b) add `consumeChatStream` to `SendChatMessageDeps` so tests can inject a stub and bypass the relative-import dependency entirely.

### Low
_(none)_

### Notes (informational only — no action)
- Round-1 Medium (React test harness reference) and Round-1 Low (return type specification) are both resolved in the revised plan.
- The `test:grading` script uses `node --test scripts/tests/*.test.mjs` which will pick up `streaming-synthesis-client.test.mjs` by glob — gate coverage is correct.
- The distinction between "heavy `@/lib/*` stubs" and "the tmpdir+import() bundling mechanism" is orthogonal — the plan conflates them. For this slice, the stubs are not needed, but the bundling mechanism is.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
_(none)_

### Medium
_(none)_

### Low
_(none)_

### Notes (informational only — no action)
- Round-2 Medium resolved: Step 4 now explicitly specifies the `mkdtemp + writeFile + await import()` tmpdir bundling mechanism, the `.mjs` extension rewrite, and cleanup — directly addressing the `./consumeChatStream` relative-import resolution requirement.
- `_state.md` Note #6 (@/lib/* stubs) correctly addressed: plan distinguishes bundling mechanism (required) from heavy stub sandbox (not needed for type-only imports).
- All prior-context paths verified to exist on disk.
- Gate ordering (build → typecheck → test_grading_gate.sh) is non-standard but not incorrect for a Next.js project.
- `SendChatMessageDeps` signature uses a comment placeholder for `setResolved`/`setComposerCtx`; implementer can derive these from Step 3 and `ChatWorkspace.tsx` — not a blocking gap.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
_(none)_

### Medium
- [x] Add a deterministic gate for the live `ChatWorkspace.tsx` wiring, not just the extracted helpers: assert the submit path delegates to `sendChatMessage(...)` (or otherwise prove the old inline `/api/chat` send block is gone) so the slice cannot pass with `consumeChatStream.ts` / `sendChatMessage.ts` tested in isolation while the real component never opts into the SSE path.
- [x] Resolve the Step-2/Step-4 harness contradiction around runtime helper imports: either require `sendChatMessage.ts` to receive any response-mapping/finalization helpers via deps so the tmpdir test remains self-contained, or update the test plan to stub those value imports explicitly; the current “no `@/lib/*` stubs are needed” claim is only true if `sendChatMessage.ts` avoids runtime imports beyond `./consumeChatStream`, which the plan does not currently guarantee.

### Low
_(none)_

### Notes (informational only — no action)
- `diagnostic/_state.md` is current enough for audit use (`last updated: 2026-04-29T20:51:50Z`), so no staleness note applies.
- All `## Prior context` paths listed in the slice exist.
- Gate ordering satisfies the current auditor note: build precedes typecheck.
