---
slice_id: 01-perf-trace-helpers
phase: 1
status: pending
owner: claude
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Add per-stage timing helpers so the chat route can record runtime / DB / LLM timings into a structured trace.

## Inputs
- `web/src/lib/serverLog.ts`
- [roadmap §4 Phase 1](../roadmap_2026-04_performance_and_upgrade.md)

## Required services / env
None at author time.

## Steps
1. Create `web/src/lib/perfTrace.ts` exporting:
   - `startSpan(name)` returning a `Span`.
   - `Span.end()` recording elapsed ms.
   - `flushTrace(requestId, spans)` writing one structured JSON line.
2. Stage names allowed: `request_intake`, `runtime_classify`, `resolve_db`, `template_match`, `sqlgen_llm`, `execute_db`, `repair_llm`, `synthesize_llm`, `sanity_check`, `total`. (Note: `runtime_classify` not `classify_llm` — classification is local.)
3. Output path is `web/logs/chat_query_trace.jsonl` (dev sink, ignored). Production sink is a later phase.
4. Add a small unit test under `web/src/lib/__tests__/perfTrace.test.ts`.

## Changed files expected
- `web/src/lib/perfTrace.ts`
- `web/src/lib/__tests__/perfTrace.test.ts`

## Artifact paths
None for this slice. `01-baseline-snapshot` produces the first promoted artifact.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
```

## Acceptance criteria
- [ ] `perfTrace.ts` exports `startSpan`, `Span.end`, `flushTrace`.
- [ ] Test asserts span elapsed > 0 and JSON shape.
- [ ] No imports from `route.ts` yet — that's `01-route-stage-timings`.

## Out of scope
- Wiring spans into `route.ts` (next slice).
- Production sink (Phase 6 or 12).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by auditor)
