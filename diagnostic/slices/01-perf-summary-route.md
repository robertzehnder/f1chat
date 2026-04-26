---
slice_id: 01-perf-summary-route
phase: 1
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Add a local/dev-only API route that aggregates the most recent N trace lines from `web/logs/chat_query_trace.jsonl` and returns a p50 / p95 summary per stage. Used to inspect the loop's perf state without grepping JSONL by hand.

## Inputs
- `web/logs/chat_query_trace.jsonl` (dev sink populated by `01-route-stage-timings`)
- [roadmap §4 Phase 1 step 3](../roadmap_2026-04_performance_and_upgrade.md)

## Prior context

Read these before triaging or implementing:

- `diagnostic/_state.md` — current phase counts, recent merges, accumulated auditor notes.
- `diagnostic/slices/01-route-stage-timings.md` — defines the JSONL trace shape this route reads. The aggregator must parse the same fields the writer emits.

## Required services / env
None at author time.

## Steps
1. Create `web/src/app/api/admin/perf-summary/route.ts`. GET handler reads the last 200 lines of `web/logs/chat_query_trace.jsonl` (use Node `fs` streaming or read whole file if tractable).
2. Group by stage name; compute count, p50, p95, max in milliseconds. Return JSON: `{ stages: { request_intake: { count, p50_ms, p95_ms, max_ms }, ... } }`.
3. Return 404 (or empty `{ stages: {} }`) if the trace file does not exist (clean local dev environment).
4. Mark this route as **local/dev only**: in production it must not run, since trace data lives elsewhere (a future production sink, see roadmap §6 / Phase 12). Gate the route with `if (process.env.NODE_ENV === 'production') return 404`.

## Changed files expected
- `web/src/app/api/admin/perf-summary/route.ts`
- `diagnostic/slices/01-perf-summary-route.md` (slice-completion note + audit verdict; always implicitly allowed)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Route exists at `web/src/app/api/admin/perf-summary/route.ts`.
- [ ] In dev mode, hitting `/api/admin/perf-summary` returns valid JSON shape (counts may be zero on first run).
- [ ] In production mode (`NODE_ENV=production`), the route returns 404.
- [ ] All gates exit 0.

## Out of scope
- A real production perf sink (deferred to Phase 6 or 12).
- Authentication on the dev route (it's gated by NODE_ENV; that's enough for now).

## Risk / rollback
Rollback: `git revert <commit>`. Route is local-dev only; no persistent state at risk.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
