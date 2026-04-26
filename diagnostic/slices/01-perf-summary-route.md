---
slice_id: 01-perf-summary-route
phase: 1
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26T13:58:07Z
---

## Goal
Add a local/dev-only API route that aggregates the most recent perfTrace records from `web/logs/chat_query_trace.jsonl` and returns a p50 / p95 summary per stage. Used to inspect the loop's perf state without grepping JSONL by hand. The window size defaults to the 200 most recent perfTrace records (records carrying a top-level `spans` array — see step 5 below) and is overridable with an `?n=<int>` query parameter (clamped to `[1, 1000]`); non-numeric or out-of-range values fall back to the default. All non-trivial behavior (parsing, filtering, percentile math, the production gate) lives in a plain JS helper `web/src/lib/perfSummary.mjs` so the existing `node --test scripts/tests/*.test.mjs` gate can exercise it without a TypeScript loader; the `route.ts` file is a thin shim around the helper.

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
1. Create plain JS helper module `web/src/lib/perfSummary.mjs` (extension `.mjs` so the existing `node --test scripts/tests/*.test.mjs` gate can import it directly without a TypeScript compile step). Exports:
   - `aggregatePerfTraces(records, n)` — pure function. `records` is an array of already-parsed perfTrace entries (each `{ spans: [...] }`); `n` is the window size. Takes the last `n` records, groups by `spans[].name`, computes `count`, `p50_ms`, `p95_ms`, `max_ms` (numbers, milliseconds, rounded to 2 decimals), and returns `{ window: { requested: <n>, returned: <records.length capped at n> }, stages: { [name]: { count, p50_ms, p95_ms, max_ms } } }`. Stages not present are omitted (no zero-count entries).
   - `parseN(rawValue)` — parses a query-string `n` value: returns the integer if it's a finite number in `[1, 1000]`, else `200`. Used by both the route and the tests.
   - `handlePerfSummaryRequest({ env, traceFilePath, n, readFile })` — orchestrator with **dependency-injected** `readFile` (the route passes `fs.promises.readFile`; tests pass a stub that records call counts so the production no-IO check is observable). Behavior:
     - If `env === 'production'`, return `{ status: 404, body: 'Not Found' }` **before calling `readFile`** (the test asserts `readFile` was never invoked in this branch — see Acceptance criteria).
     - Else, call `readFile(traceFilePath, 'utf8')`. On rejection with `code === 'ENOENT'`, return `{ status: 200, body: { window: { requested: n, returned: 0 }, stages: {} } }`. Other rejections also return that empty 200 shape (the route never 5xxs for IO/parse failures).
     - Split content on `\n`, drop empty lines, parse each line with `JSON.parse` inside a `try/catch` (silently skip malformed lines — see step 5). Filter to entries where `Array.isArray(entry.spans)` is true. Call `aggregatePerfTraces(filtered, n)` and return `{ status: 200, body: <result> }`.
2. Create `web/src/app/api/admin/perf-summary/route.ts` as a thin Next.js wrapper. Its `GET` handler:
   - Reads `?n=` from the request URL and passes the raw value through `parseN` (imported from the helper).
   - Calls `handlePerfSummaryRequest({ env: process.env.NODE_ENV, traceFilePath: process.env.OPENF1_PERF_SUMMARY_TRACE_PATH ?? path.join(process.cwd(), 'web/logs/chat_query_trace.jsonl'), n, readFile: fs.promises.readFile })`.
   - Wraps the returned `{ status, body }` in a `Response` (`Response.json(body, { status })` for status 200; `new Response('Not Found', { status: 404 })` for status 404). Contains no aggregation, parsing, or filtering logic of its own — all behavior the gate test must exercise lives in the helper.
3. Window-size policy lives in `parseN`: defaults to 200, accepts `?n=<int>` clamped to `[1, 1000]`, non-numeric / NaN / out-of-range falls back to 200.
4. Mark this route as **local/dev only**: in production it must not run, since trace data lives elsewhere (a future production sink, see roadmap §6 / Phase 12). The production gate is the very first statement of `handlePerfSummaryRequest` (step 1) and runs before the injected `readFile` is called; the test verifies non-invocation of the `readFile` stub.
5. Coexistence with `appendQueryTrace` + malformed-line resilience (handled inside `handlePerfSummaryRequest`):
   - Lines that fail `JSON.parse` are silently skipped (no throw, no log).
   - Parsed entries where `Array.isArray(entry.spans)` is false are silently skipped (the `appendQueryTrace` rows from `01-route-stage-timings` coexist in the same JSONL but do not carry a top-level `spans` array).
   - Span entries within an otherwise-valid perfTrace record that are not `{ name: string, elapsedMs: number }` — including `NaN`, non-finite, or negative `elapsedMs` — are skipped individually; the rest of the record's spans still aggregate.
   - The helper always returns `status: 200` or `status: 404`; it never throws or returns 5xx for parse / shape / IO failures.

## Changed files expected
- `web/src/lib/perfSummary.mjs` — new plain JS helper (~120 LOC) holding all parsing, filtering, percentile, and prod-gate logic. Plain JS (not TypeScript) so the `.mjs` gate test can `import` it directly without a build step.
- `web/src/app/api/admin/perf-summary/route.ts` — thin Next.js shim (~30 LOC) that wires `process.env`, the request URL, and `fs.promises.readFile` into `handlePerfSummaryRequest`.
- `web/scripts/tests/perf-summary-route.test.mjs` — new (~120 LOC) gate test. Picked up by the existing `node --test scripts/tests/*.test.mjs` glob in `npm run test:grading`, so no `package.json` change is needed. The test does NOT import `route.ts` (TypeScript cannot be loaded under the plain `node --test` runner without an extra loader) — it imports the plain JS helper `web/src/lib/perfSummary.mjs` directly and exercises `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest`. Coverage:
  - Writes a fixture JSONL in `os.tmpdir()` containing an `appendQueryTrace`-shaped entry (no top-level `spans`), a perfTrace entry (with `spans`), and one malformed line; passes the path to `handlePerfSummaryRequest` along with a stub `readFile` that wraps the real `fs.promises.readFile` and records call counts. Asserts dev-mode response shape, that only the perfTrace entry contributes to `stages`, and that the malformed line is silently skipped.
  - Calls `handlePerfSummaryRequest({ env: 'production', traceFilePath: <fixture path>, n: 200, readFile: stub })` with the same fixture and asserts `status === 404` AND `stub.callCount === 0` — this is the observable proof the production branch performed no file I/O (replaces the previous "404 with a missing path" check, which only proved an absent file, not absent IO).
  - Calls `aggregatePerfTraces` directly with hand-built record arrays to verify percentile math and the n-clamp (n ≤ 0, n > 1000, NaN, non-numeric).
  - Calls `parseN` directly to verify `[1, 1000]` clamp + 200 fallback for `null`, `''`, `'abc'`, `'-5'`, `'5000'`.
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
- [ ] Helper module exists at `web/src/lib/perfSummary.mjs` exporting `aggregatePerfTraces`, `parseN`, and `handlePerfSummaryRequest`.
- [ ] Route exists at `web/src/app/api/admin/perf-summary/route.ts`, imports from the helper, and `npm run typecheck` resolves it.
- [ ] `web/scripts/tests/perf-summary-route.test.mjs` exists, is executed by `npm run test:grading` (via the existing `node --test scripts/tests/*.test.mjs` glob without any TS loader), imports `web/src/lib/perfSummary.mjs` directly, and asserts:
  - `handlePerfSummaryRequest` invoked with `env: 'development'` and a fixture JSONL containing both an `appendQueryTrace`-shaped entry (no `spans`), a perfTrace entry (with `spans`), and one malformed line returns `{ status: 200, body: { window: { requested: number, returned: number }, stages: { [stageName]: { count: number, p50_ms: number, p95_ms: number, max_ms: number } } } }`; only the perfTrace entry's spans contribute to `stages`; the malformed line is silently skipped.
  - `handlePerfSummaryRequest` invoked with `env: 'production'`, the same fixture path, and a `readFile` stub that records call counts returns `{ status: 404 }` AND the stub's call count is `0` — directly observable proof the production branch performed no file I/O.
  - `handlePerfSummaryRequest` invoked with a `traceFilePath` that does not exist (in dev mode) returns `{ status: 200, body: { window: { requested, returned: 0 }, stages: {} } }`.
  - `aggregatePerfTraces` with hand-built records produces correct `p50_ms`, `p95_ms`, `max_ms` values (rounded to 2 decimals) and omits stages not present in the window.
  - `parseN` returns 200 for `null`, `''`, `'abc'`, `NaN`, `'-5'`, `'5000'`, and `'0'`; returns the clamped integer for `'1'`, `'500'`, `'1000'`.
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
- [x] Replace the direct `.mjs` import of `web/src/app/api/admin/perf-summary/route.ts` with an executable test strategy that works under the listed `node --test scripts/tests/*.test.mjs` gate, such as importing the built route artifact after `npm run build` or testing a plain JS helper exported from an importable module.
- [x] Make the production "no file I/O" acceptance check actually observable, because asserting 404 with a missing path does not prove the handler returned before attempting to read the trace file.

### Medium

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] Align the route's default trace path with the existing writers in `web/src/lib/perfTrace.ts` and `web/src/lib/serverLog.ts`: read from `process.env.OPENF1_WEB_LOG_DIR ?? path.join(process.cwd(), "logs")` plus `chat_query_trace.jsonl`, or otherwise explicitly document and test why `path.join(process.cwd(), "web/logs/chat_query_trace.jsonl")` is correct when gates and the Next app run from `web/`.

### Medium
- [ ] Resolve the `n`-policy ambiguity by stating whether `aggregatePerfTraces(records, n)` must sanitize invalid/out-of-range `n` values itself, or remove the direct aggregate "n-clamp" test coverage and leave all invalid query handling to `parseN`.

### Low

### Notes (informational only — no action)
- `_state.md` was last updated at `2026-04-26T13:47:29Z`, which is less than 24 hours old at audit time.
