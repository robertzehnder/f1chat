---
slice_id: 07-streaming-synthesis
phase: 7
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
