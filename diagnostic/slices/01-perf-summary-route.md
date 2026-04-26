---
slice_id: 01-perf-summary-route
phase: 1
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T13:52:26Z
---

## Goal
Add a local/dev-only API route that aggregates the most recent perfTrace records from `web/logs/chat_query_trace.jsonl` and returns a p50 / p95 summary per stage. Used to inspect the loop's perf state without grepping JSONL by hand. The window size defaults to the 200 most recent perfTrace records (records carrying a top-level `spans` array — see step 5 below) and is overridable with an `?n=<int>` query parameter (clamped to `[1, 1000]`); non-numeric or out-of-range values fall back to the default.

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
1. Create `web/src/app/api/admin/perf-summary/route.ts`. The GET handler:
   - Reads `web/logs/chat_query_trace.jsonl` end-to-end via `fs.promises.readFile` (acceptable for a dev sink; the file is bounded by the loop's local usage and live production traffic does not write to it — see step 4).
   - Splits on `\n`, drops empty lines, and parses each line with `JSON.parse` inside a `try/catch`. See step 6 for malformed-line handling.
   - After parsing, filter the records down to perfTrace entries: keep only entries where `Array.isArray(entry.spans)` is true. This is the contract documented by `01-route-stage-timings` — `appendQueryTrace` entries coexist in the same file but do not carry a top-level `spans` array, so this filter cleanly isolates the structured stage-timing records.
   - Take the last `N` of the filtered perfTrace records (most-recent window). `N` defaults to 200 and accepts an `?n=<int>` query param clamped to `[1, 1000]`; non-numeric / NaN / out-of-range values silently fall back to 200.
2. Group by stage name across the windowed records' `spans[].name` / `spans[].elapsedMs`; compute `count`, `p50_ms`, `p95_ms`, `max_ms` (numbers, milliseconds; round to 2 decimals). Return JSON: `{ window: { requested: <n>, returned: <records> }, stages: { request_intake: { count, p50_ms, p95_ms, max_ms }, ... } }`. Stages not present in the window are omitted (no zero-count entries).
3. Return HTTP 200 with `{ window: { requested: <n>, returned: 0 }, stages: {} }` if the trace file does not exist or contains no perfTrace records (clean local dev environment). Do NOT return 404 in that case — the route is "available but empty"; 404 is reserved for the production gate in step 4.
4. Mark this route as **local/dev only**: in production it must not run, since trace data lives elsewhere (a future production sink, see roadmap §6 / Phase 12). Gate the route with `if (process.env.NODE_ENV === 'production') return new Response('Not Found', { status: 404 })` as the very first statement of the handler, before any file I/O.
5. Coexistence with `appendQueryTrace`: the route MUST tolerate (and ignore) non-perfTrace JSONL entries that share the file. Concretely, after `JSON.parse` succeeds, the handler skips any entry where `Array.isArray(entry.spans)` is false. Do not throw, do not log, do not include such entries in the window or counts. Also skip parsed perfTrace entries whose `spans` array contains malformed span objects — see step 6.
6. Resilience to malformed JSONL: a single bad log line must not break the route.
   - Lines that fail `JSON.parse` are silently skipped (no throw, no log).
   - Parsed entries that pass the `Array.isArray(entry.spans)` filter but contain individual span entries that are not `{ name: string, elapsedMs: number }` — including `NaN`, non-finite, or negative `elapsedMs` — have those individual span entries skipped while the rest of the entry's spans are still aggregated.
   - The handler always returns HTTP 200 (or HTTP 404 in production per step 4); it never returns 5xx for parse / shape failures.

## Changed files expected
- `web/src/app/api/admin/perf-summary/route.ts`
- `web/scripts/tests/perf-summary-route.test.mjs` — new (~80 LOC) gate test (see "Acceptance criteria" and "Gate commands"). Picked up by the existing `node --test scripts/tests/*.test.mjs` glob in `npm run test:grading`, so no `package.json` change is needed. The test imports the route module directly (no live HTTP server), writes a small fixture JSONL containing both an `appendQueryTrace`-shaped entry (no `spans`) and a perfTrace entry (with `spans`) plus one malformed line, then asserts: (a) `GET` in dev returns 200 with the documented `{ window, stages }` shape and only counts the perfTrace entry's spans; (b) the malformed line and the non-`spans` entry are silently skipped; (c) `process.env.NODE_ENV='production'` makes the same handler return 404 before any file I/O. The test stubs the trace path via an env var the route reads (`OPENF1_PERF_SUMMARY_TRACE_PATH`, defaulting to `web/logs/chat_query_trace.jsonl` when unset) so the fixture lives in `os.tmpdir()` and the real dev sink is untouched.
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
- [ ] Route exists at `web/src/app/api/admin/perf-summary/route.ts` and `npm run typecheck` resolves it.
- [ ] `web/scripts/tests/perf-summary-route.test.mjs` exists, is executed by `npm run test:grading` (via the existing `node --test scripts/tests/*.test.mjs` glob), and asserts:
  - GET in dev (`NODE_ENV !== 'production'`) returns HTTP 200 with body matching `{ window: { requested: number, returned: number }, stages: { [stageName]: { count: number, p50_ms: number, p95_ms: number, max_ms: number } } }`. Counts of zero render as `{ window: { requested, returned: 0 }, stages: {} }`.
  - When the fixture JSONL contains both an `appendQueryTrace`-shaped entry (no top-level `spans`) and a perfTrace entry (with `spans`), only the perfTrace entry's spans contribute to `stages` (the non-`spans` entry is silently skipped).
  - A malformed JSONL line in the fixture does not cause a non-200 response and does not appear in `stages`.
  - With `process.env.NODE_ENV='production'` the same handler returns HTTP 404 and performs no file I/O (verified by pointing `OPENF1_PERF_SUMMARY_TRACE_PATH` at a path that does not exist and confirming no read attempt — e.g., the test asserts the response is 404 even when the path is missing).
  - The `?n=` query param clamps to `[1, 1000]` and falls back to 200 on non-numeric input.
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Specify that the aggregator must ignore non-perfTrace JSONL entries and only summarize records where `Array.isArray(entry.spans)`, because the referenced timing slice says `appendQueryTrace` entries coexist in the same file.
- [x] Add an executable verification path for the dev JSON shape and production 404 behavior, or rewrite those acceptance criteria so they are checked by the listed gates.

### Medium
- [x] Define the request parameter or fixed policy for "most recent N" trace lines, since step 1 hard-codes the last 200 lines while the goal says the route aggregates the most recent N.
- [x] State how malformed JSONL lines or malformed perfTrace records should be handled so one bad log line does not make the dev summary route fail unexpectedly.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Replace the direct `.mjs` import of `web/src/app/api/admin/perf-summary/route.ts` with an executable test strategy that works under the listed `node --test scripts/tests/*.test.mjs` gate, such as importing the built route artifact after `npm run build` or testing a plain JS helper exported from an importable module.
- [ ] Make the production "no file I/O" acceptance check actually observable, because asserting 404 with a missing path does not prove the handler returned before attempting to read the trace file.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.
