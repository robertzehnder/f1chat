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

## Steps
1. Switch the route handler to a streaming response (Next.js `Response` with `ReadableStream`).
2. Update `chatRuntime` synthesis to yield partial tokens.
3. Verify the existing chat UI still renders the streamed response (or update the UI if needed).
4. Add a test that asserts the response is chunked (multiple write() calls) for a typical answer.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/lib/chatRuntime.ts`
- `web/src/components/chat/ChatPanel.tsx`
- `web/scripts/tests/streaming-synthesis.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Streaming test asserts ≥3 chunked writes for a multi-paragraph answer.
- [ ] Chat UI renders streamed content.

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
- [ ] Replace the `write()`-based streaming assertion with a transport-accurate chunk assertion against the `Response`/`ReadableStream` body, because this slice does not use a Node `ServerResponse` writer (`diagnostic/slices/07-streaming-synthesis.md:25`, `diagnostic/slices/07-streaming-synthesis.md:28`, `diagnostic/slices/07-streaming-synthesis.md:47`).

### Medium
- [ ] Add a deterministic gate or test target for the UI streaming claim so “Chat UI renders streamed content” is verifiable by a command rather than a manual check (`diagnostic/slices/07-streaming-synthesis.md:27`, `diagnostic/slices/07-streaming-synthesis.md:43`, `diagnostic/slices/07-streaming-synthesis.md:48`).

### Low
- [ ] Clarify whether Step 3 is expected to modify the UI or only verify existing behavior, so the implementer knows whether `web/src/components/chat/ChatPanel.tsx` is planned scope or contingent scope (`diagnostic/slices/07-streaming-synthesis.md:27`, `diagnostic/slices/07-streaming-synthesis.md:33`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-29T18:25:29Z, so no staleness note applies.
- `web/package.json` currently defines `test:grading` as `node --test scripts/tests/*.test.mjs`, so the planned test path is covered by the existing gate.
