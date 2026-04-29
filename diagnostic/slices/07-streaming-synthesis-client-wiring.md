---
slice_id: 07-streaming-synthesis-client-wiring
phase: 7
status: pending_plan_audit
owner: claude
user_approval_required: no
created: 2026-04-29
updated: 2026-04-29T15:40:00-04:00
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
1. **Add `web/src/lib/chat/consumeChatStream.ts`** — a transport-agnostic helper that takes a `fetch` Response and yields the same shape regardless of whether the server returned SSE or JSON:
   ```ts
   export async function consumeChatStream(
     response: Response,
     hooks: { onAnswerDelta?(text: string): void; onReasoningDelta?(text: string): void }
   ): Promise<{ answer: string; reasoning: string; /* + same fields as today's JSON */ }>
   ```
   - If `response.headers.get("content-type")?.startsWith("text/event-stream")`: parse SSE per the route's documented frame contract. For each `answer_delta`/`reasoning_delta` frame, fire the corresponding hook with the text. On `final`, return the parsed JSON payload. On `error`, throw with the frame's message.
   - Otherwise (server returned JSON either because SSE not supported or proxy stripped headers): `await response.json()`, fire `onAnswerDelta(answer)` with the entire answer string, then return the JSON. (Graceful degradation: client UX still works without progressive updates.)
2. **Update `web/src/components/chat/ChatWorkspace.tsx`**:
   - Add `Accept: text/event-stream` to the chat POST headers.
   - **Before** calling `consumeChatStream`, insert a placeholder assistant message (empty `content`, marked as streaming) into the active conversation via `patchActiveConversation(...)`. Capture the placeholder's id.
   - Pass `consumeChatStream`'s `onAnswerDelta` hook a callback that patches the placeholder's `content` by id (using the existing `patchActiveConversation` setter pattern, NOT a hypothetical `setMessages`). The callback must look up the placeholder by id rather than by index — order changes must not break it.
   - When `consumeChatStream` resolves, replace the placeholder with the final assistant message (full JSON payload) via the same `patchActiveConversation` path, marking streaming complete.
   - If `consumeChatStream` throws, replace the placeholder with an error message (same shape today's error UI uses); do not leave the placeholder in `streaming` state.
3. **Test** at `web/scripts/tests/streaming-synthesis-client.test.mjs`:
   - Test the helper directly with synthetic Response objects (SSE body + JSON body), asserting hooks fire correctly and the final return shape matches.
   - Test ChatWorkspace integration via the existing harness pattern (see `web/scripts/tests/answer-cache.test.mjs` for the React-component testing approach already in use): assert placeholder is inserted BEFORE the first delta, deltas patch the placeholder by id, final replaces the placeholder with the synthesized answer, and an error mid-stream replaces the placeholder with an error UI.

## Changed files expected
- `web/src/lib/chat/consumeChatStream.ts` (new — transport-agnostic helper).
- `web/src/components/chat/ChatWorkspace.tsx` (additive: `Accept` header, placeholder-first ordering, hook wiring).
- `web/scripts/tests/streaming-synthesis-client.test.mjs` (new).
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
- [ ] `web/src/lib/chat/consumeChatStream.ts` exists and handles both SSE and JSON `fetch` responses, exposing the documented hooks API.
- [ ] `ChatWorkspace.tsx` sends `Accept: text/event-stream`, inserts a placeholder assistant message BEFORE the first delta, patches by id (not index), and finalizes via `patchActiveConversation` when the stream resolves.
- [ ] Graceful JSON fallback: when the server returns JSON instead of SSE, the helper still fires `onAnswerDelta(answer)` and returns the same final shape; ChatWorkspace's placeholder UX still completes successfully.
- [ ] Tests cover: SSE path with multiple deltas, JSON fallback path, error mid-stream, placeholder-id resilience to message-list reordering.
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
