---
slice_id: 10-session-detail-strategy-summary
phase: 10
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T18:03:23-04:00
---

## Goal
Add a strategy-summary card to the session-detail page that, per driver, surfaces pit-stop count, compounds used, and the one-stop/two-stop classification. Data must come from the materialized `core.strategy_summary` contract — no `raw.*` reads.

## Inputs
- `web/src/app/sessions/[sessionKey]/page.tsx` (existing session-detail page)
- `web/src/lib/queries/sessions.ts` (existing query module)
- `sql/012_strategy_summary_mat.sql` (column inventory for `core.strategy_summary`)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10

## Prior context
- `diagnostic/_state.md`
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` (reference for source-inspection grading-test pattern)
- `web/scripts/tests/session-detail-pace-table.test.mjs` (reference for source-inspection grading-test pattern)

## Required services / env
None at author time. Tests are pure source-inspection (Node `node:test`) and do not require a live database.

## Steps
1. Add `export async function getSessionStrategySummary(sessionKey: number)` to `web/src/lib/queries/sessions.ts`. The body must `SELECT ... FROM core.strategy_summary WHERE session_key = $1` and project the columns the card consumes: `driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `compounds_used`, `strategy_type`, `total_pit_duration_seconds`, `pit_laps`. Order by `driver_number ASC`. Do not reference `raw.*` tables.
2. Create `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` as a default-exported function component taking `{ rows: Record<string, unknown>[] }`. Render one row per driver showing: `#<driver_number> <driver_name> · <team_name>`, `pit_stop_count`, the `compounds_used` array joined as a readable list, and `strategy_type`. Mark each driver row with `data-testid="strategy-row"` and the strategy-type cell with `data-testid="strategy-type"`.
3. Wire `StrategySummary` into `web/src/app/sessions/[sessionKey]/page.tsx`:
   - Default-import `StrategySummary` from `./StrategySummary`.
   - Import `getSessionStrategySummary` from `@/lib/queries/sessions` (the same module path used by the existing `getSessionDriverPace` / `getSessionStintTimeline` imports). Do NOT import from the `@/lib/queries` barrel — `web/src/lib/queries.ts` is not modified by this slice, so the new function is only reachable via the per-module specifier.
   - Insert `getSessionStrategySummary(key)` into the existing `await Promise.all([...])` **before** the existing `getSessionStintTimeline(key)` call, and add the matching binding (e.g. `strategySummary`) into the destructured array **before** `stints`. This preserves `stints` as the LAST destructured identifier, which the existing `web/scripts/tests/session-detail-stint-timeline.test.mjs` G3/G5 regex (`/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/`) relies on; reordering after `getSessionStintTimeline` would make the new identifier the trailing slot and break those non-baseline tests.
   - Render `<StrategySummary rows={strategySummary} />` directly inside the page-level `<div className="stack">` flow (no extra `<section>` / card / wrapper element — adjacent slices like `<PaceTable>` and `<StintTimeline>` render bare into the stack), positioned immediately after `<StintTimeline rows={stints} />` and before the existing weather/race-control `<div className="two-col">` block whose first child is `<DataTable title="Weather Preview" ...>`.
4. Add the source-inspection grading test `web/scripts/tests/session-detail-strategy-summary.test.mjs` mirroring the structure of `web/scripts/tests/session-detail-stint-timeline.test.mjs`. Required assertions (G1–G5) are spelled out under Acceptance criteria. The test must NOT rely on the "last destructured identifier" shortcut (since this slice intentionally keeps `stints` as the trailing slot); instead, G3/G5 must extract the strategy-summary row-binding directly from the JSX (`<StrategySummary rows={(\w+)}`).

## Changed files expected
- `web/src/lib/queries/sessions.ts` (new export `getSessionStrategySummary`)
- `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` (new component)
- `web/src/app/sessions/[sessionKey]/page.tsx` (import + Promise.all entry + render slot)
- `web/scripts/tests/session-detail-strategy-summary.test.mjs` (new dedicated grading test)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/scripts/tests/session-detail-strategy-summary.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `getSessionStrategySummary` is declared in `web/src/lib/queries/sessions.ts`; its body contains `FROM core.strategy_summary` and `WHERE session_key = $1`; it does NOT reference `raw.stints` or `raw.pit`; and it references each of `driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `compounds_used`, `strategy_type`, `total_pit_duration_seconds`, `pit_laps`.
  - **G2**: `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` exists, exports a default function, and contains the literal substrings `data-testid="strategy-row"`, `data-testid="strategy-type"`, `compounds_used`, `pit_stop_count`, and `strategy_type`.
  - **G3**: `page.tsx` (a) imports `getSessionStrategySummary` from `@/lib/queries/sessions` specifically (the per-module path; the `@/lib/queries` barrel form is NOT accepted because this slice does not modify `web/src/lib/queries.ts` to re-export the new function); (b) calls `getSessionStrategySummary(` inside the `await Promise.all([...])` argument list; (c) contains a `<StrategySummary rows={<binding>}` JSX element from which `<binding>` is extracted via the regex `/<StrategySummary\s+rows=\{(\w+)\}/` (NOT via the trailing-destructure shortcut); and (d) `<binding>` appears as one of the destructured identifiers in the `const [ ... ] = await Promise.all([...])` array. The test MUST NOT assume the new binding is the last destructured slot — `stints` is intentionally preserved as the trailing slot to keep the existing stint-timeline grading test passing.
  - **G4**: `page.tsx` default-imports `StrategySummary` from `./StrategySummary`.
  - **G5**: In `page.tsx`, the `<StrategySummary rows={<binding>}>` element (with `<binding>` extracted per G3 from `/<StrategySummary\s+rows=\{(\w+)\}/`) appears AFTER the literal substring `<StintTimeline rows={` (matched as a generic substring with no captured-binding interpolation, so the assertion is independent of which identifier ends up in `<StintTimeline rows={...}>`) and BEFORE the literal substring `Weather Preview` (which marks the start of the existing two-col weather/race-control block).
- [ ] `cd web && npm run build` exits 0.
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (any pre-existing baseline failures must not regress; in particular, `web/scripts/tests/session-detail-stint-timeline.test.mjs` G3 and G5 must continue to pass — they are NOT in `scripts/loop/state/test_grading_baseline.txt` and rely on `stints` remaining the LAST destructured identifier in `page.tsx`'s `await Promise.all([...])`, which Step 3 explicitly preserves).

## Out of scope
- Undercut/overcut evidence (lives in `core.strategy_evidence_summary`, separate slice).
- Pit-cycle position-change visualization (lives in `core.pit_cycle_summary`, separate slice).
- Database-layer changes (the `core.strategy_summary` materialization already exists at `sql/012_strategy_summary_mat.sql`).

## Risk / rollback
Rollback: `git revert <commit>`. The card is additive; no existing route, query, or component is modified except for the additive `Promise.all` entry and render slot in `page.tsx`.

## Slice-completion note

**Branch:** `slice/10-session-detail-strategy-summary` (off integration/perf-roadmap @ 6b90d34 plan-approved tip)

**Changed files (exactly the four scoped):**
- `web/src/lib/queries/sessions.ts` — added `export async function getSessionStrategySummary(sessionKey: number)` after `getSessionStintTimeline`. Body selects `driver_number, driver_name, team_name, total_stints, pit_stop_count, compounds_used, strategy_type, total_pit_duration_seconds, pit_laps` `FROM core.strategy_summary WHERE session_key = $1 ORDER BY driver_number ASC`. No `raw.*` references.
- `web/src/app/sessions/[sessionKey]/StrategySummary.tsx` — new default-exported function component `StrategySummary({ rows })`. Renders one row per driver with `data-testid="strategy-row"`, a strategy-type cell with `data-testid="strategy-type"`, and a `compounds_used` join helper. Contains all five required substrings (`data-testid="strategy-row"`, `data-testid="strategy-type"`, `compounds_used`, `pit_stop_count`, `strategy_type`).
- `web/src/app/sessions/[sessionKey]/page.tsx` — added `getSessionStrategySummary` to the `@/lib/queries/sessions` import block (per-module path, not the barrel); added `StrategySummary` default-import from `./StrategySummary`; inserted `getSessionStrategySummary(key)` BEFORE `getSessionStintTimeline(key)` in the `Promise.all` arg list and `strategySummary` BEFORE `stints` in the destructure (preserving `stints` as the LAST destructured identifier per the round-2 plan-audit fix); rendered `<StrategySummary rows={strategySummary} />` directly into the page-level `<div className="stack">` flow, immediately after `<StintTimeline rows={stints} />` and before the `Weather Preview` two-col block (no wrapper element).
- `web/scripts/tests/session-detail-strategy-summary.test.mjs` — new dedicated `node:test` source-inspection grading test with G1–G5 mirroring the spec. G3/G5 extract the strategy-summary binding via `/<StrategySummary\s+rows=\{(\w+)\}/` (no last-destructure-slot shortcut) and use `<StintTimeline rows={` as a generic substring landmark.

**Decisions:**
- Used per-module import path `@/lib/queries/sessions` for `getSessionStrategySummary` (round-4 plan-audit resolution); `web/src/lib/queries.ts` barrel was deliberately not modified (kept out of `Changed files expected`).
- Added the new `Promise.all` entry and destructured binding immediately ahead of the existing `getSessionStintTimeline(key)` / `stints` slot, leaving `stints` as the trailing identifier so the existing `web/scripts/tests/session-detail-stint-timeline.test.mjs` G3/G5 (which capture the LAST destructured identifier and lookup `<StintTimeline rows={captured}>`) continue to pass — verified by running that suite directly post-edit (5/5 ok).
- `StrategySummary.tsx` renders bare into the page-level stack (no extra `<section>`/card wrapper), matching the adjacent `<PaceTable>`/`<StintTimeline>` convention per Step 3.

**Gate commands (exit codes):**
- `cd web && npm run build` → exit 0 (Next.js 15.5.15, compiled successfully, type-checked, 4 static pages generated, all routes including `/sessions/[sessionKey]` listed).
- `cd web && npm run typecheck` → exit 0 (`tsc --noEmit` clean).
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`). New `session-detail-strategy-summary` suite: 5/5 G1–G5 pass when run in isolation. `session-detail-stint-timeline` suite: 5/5 still pass (no regression).

**Self-check vs Acceptance criteria:**
- G1 ✓ — `getSessionStrategySummary` declared in `sessions.ts`, body has `FROM core.strategy_summary`, `WHERE session_key = $1`, no `raw.stints`/`raw.pit`, all 9 columns referenced.
- G2 ✓ — `StrategySummary.tsx` exists, default-exports a function, contains all 5 required substrings.
- G3 ✓ — page.tsx imports `getSessionStrategySummary` from `@/lib/queries/sessions` specifically; calls `getSessionStrategySummary(` inside `Promise.all([...])`; renders `<StrategySummary rows={strategySummary}` (extracted via `/<StrategySummary\s+rows=\{(\w+)\}/`); `strategySummary` appears in the destructured identifier list (between `pace` and `stints`).
- G4 ✓ — `import StrategySummary from "./StrategySummary"`.
- G5 ✓ — element ordering: `<StintTimeline rows={` (literal substring) → `<StrategySummary rows={strategySummary}` → `Weather Preview`. All three indices found and ordered as required.
- Build/typecheck/grading-gate all exit 0; baseline stint-timeline tests un-regressed.

**Out-of-scope verification:** No DB migrations, no `raw.*` reads, no changes to `web/src/lib/queries.ts` barrel, no changes to other session-detail components, no edits to baseline files or other slices' artifacts.

**Commit:** see `[slice:10-session-detail-strategy-summary][awaiting-audit]` commit on this branch (hash recorded in branch HEAD post-push).

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop's baseline-aware grading gate instead of the raw repo-wide test script.

### Medium
- [x] Fix the `Changed files expected` paths to use the real session-detail route segment `web/src/app/sessions/[sessionKey]/...` instead of nonexistent `[id]` paths.
- [x] Expand `Changed files expected` to include the query-layer and grading-test files this slice will need, at minimum the `web/src/lib/queries/sessions.ts` contract reader and a dedicated `web/scripts/tests/session-detail-strategy-summary.test.mjs` gate file.
- [x] Replace the Playwright/RTL-or-screenshot fallback in Step 3 with the repo's actual grading-test approach, since this codebase already uses source-inspection node tests for adjacent session-detail slices and does not rely on Playwright/RTL here.
- [x] Rewrite the acceptance criteria as command-verifiable outcomes that name the required `core.strategy_summary` wiring and the concrete grading assertion(s), rather than broad statements like "renders without runtime errors" and "matches the underlying contract for at least one test session."

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:41:07Z, so the loop context is current.
- Adjacent implemented session-detail slices already follow the `[sessionKey]` route shape and dedicated grading-test pattern in `web/scripts/tests/session-detail-*.test.mjs`.

## Plan-audit verdict (round 2)

**Status: REVISE**
**Auditor: claude-plan-audit (round-2 forced-findings ratchet: not applied — High item identified)**

### High
- [x] The slice will introduce NEW (non-baseline) regressions in `web/scripts/tests/session-detail-stint-timeline.test.mjs` G3 and G5. Those existing tests use the regex `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` and assert on `<StintTimeline rows={${captured}}` — `captured` is the LAST destructured identifier in `page.tsx`'s `await Promise.all([...])`. Today the last identifier is `stints`, so G3 and G5 pass. Adding `getSessionStrategySummary` as a new entry per Steps 1+3 makes the new strategy identifier the last destructured slot, so `captured` becomes that new identifier, and both G3's `<StintTimeline rows={strategySummary}>` lookup and G5's same-binding ordering check will fail. Verified against the current `page.tsx` (regex captures `stints`; the analogous `<PaceTable rows={stints}` lookup already returns false — that's the existing baseline failure for `getSessionDriverPace`'s G3, present in `scripts/loop/state/test_grading_baseline.txt`); the same shape will newly catch the stint-timeline tests, and stint-timeline G3/G5 are NOT in the baseline. Resolve by either (a) adding `web/scripts/tests/session-detail-stint-timeline.test.mjs` to `## Changed files expected` with an explicit Step that rewrites its G3/G5 to extract the StintTimeline binding directly from JSX (e.g. `/<StintTimeline\s+rows=\{(\w+)\}/`) instead of recomputing the captured destructure tail, OR (b) restructuring this slice's wiring so `stints` remains the last destructure entry and changing this slice's own G3 to extract its identifier the same JSX-binding way.

### Medium
- [x] G3 of the new test inherits the same "capture the LAST destructure identifier" shortcut. This locks `getSessionStrategySummary` as the trailing slot and propagates the same fragility — any future Phase 10 slice that bolts onto the shared `Promise.all` will repeat the regression cascade. Specify that G3 must extract the strategy-summary binding directly from the JSX (e.g. `/<StrategySummary\s+rows=\{(\w+)\}/`), then verify that identifier is one of the destructured names and that `getSessionStrategySummary(` appears in the `Promise.all` argument list.
- [x] G5 wording (`<StrategySummary rows={...}> appears AFTER <StintTimeline rows={...}> and BEFORE the Weather Preview two-col block`) does not say HOW to locate the StintTimeline element. If the implementer mirrors the existing stint-timeline G5 verbatim and uses the captured-tail identifier for the `<StintTimeline rows={…}>` index, the lookup will fail. Pin the spec: locate `<StintTimeline rows={` as a generic literal substring (no captured binding) and the strategy-summary element via the binding extracted in G3.

### Low
- [x] Step 3's render-slot phrase ("immediately after `<StintTimeline rows={...}>` and before the weather/race-control two-col block") is unambiguous about position but does not name the section wrapper or class. Adjacent slices render directly into the page-level `<div className="stack">` flow with no wrapper; state that explicitly so the implementer does not introduce a new `<section>`/card wrapper that would also need its own gate assertion.

### Notes (informational only — no action)
- The pace-table G3 failure (`page.tsx wires the awaited getSessionDriverPace result into <PaceTable rows={...}> via a shared identifier`) is already in `scripts/loop/state/test_grading_baseline.txt`, so it stays as a tolerated baseline failure regardless of which identifier ends up last after this slice.
- Slice scope, column inventory (matches `sql/012_strategy_summary_mat.sql`), no-`raw.*` rule, dedicated grading-test pattern, and use of `bash scripts/loop/test_grading_gate.sh` are all correctly aligned with the round-1 revisions.
- `web/src/app/sessions/[sessionKey]/page.tsx` and `web/src/lib/queries/sessions.ts` were inspected only to verify the regression claim above; no other file was modified during this audit.

## Plan-audit verdict (round 3)

**Status: APPROVED**
**Auditor: claude-plan-audit (round-3 forced-findings ratchet: not applicable)**

### High
(none)

### Medium
(none)

### Low
(none)

### Notes (informational only — no action)
- Round 1 (1 High + 4 Mediums) and round 2 (1 High + 2 Mediums + 1 Low) are all resolved.
- Step 3 explicitly preserves `stints` as the LAST destructured identifier in `await Promise.all([...])` by inserting `getSessionStrategySummary(key)` BEFORE `getSessionStintTimeline(key)` and the matching binding BEFORE `stints`; this keeps the existing `web/scripts/tests/session-detail-stint-timeline.test.mjs` G3/G5 (NOT in baseline, currently green) passing, and decouples this slice's new G3/G5 from destructure-trailing-slot ordering by extracting the strategy-summary binding via `/<StrategySummary\s+rows=\{(\w+)\}/` and using `<StintTimeline rows={` as a generic substring landmark.
- Step 1's column projection (`driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `compounds_used`, `strategy_type`, `total_pit_duration_seconds`, `pit_laps`) all exist on `core.strategy_summary_mat` per `sql/012_strategy_summary_mat.sql:14-32`, and the contract is read via the `core.strategy_summary` facade view, satisfying the "no `raw.*`" rule.
- Step 3 is now explicit that the render slot is bare into the page-level `<div className="stack">` flow (no wrapper `<section>`/card), matching the adjacent `<PaceTable>` and `<StintTimeline>` convention.
- Gate set (`cd web && npm run build` → `cd web && npm run typecheck` → `bash scripts/loop/test_grading_gate.sh`) is well-formed; the build/typecheck order is non-blocking since both run independently against the same source tree, and the wrapper handles baseline-tolerance (or strict fallback when the baseline file is absent).
- This is the round-3 (final) Claude self-audit per `LOOP_CLAUDE_PLAN_AUDIT_CAP=3`. Slice now hands off to codex for the gating external plan audit.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Resolve the query import surface inconsistency: either constrain Step 3 and Acceptance G3 to import `getSessionStrategySummary` from `@/lib/queries/sessions`, or add an explicit step plus `web/src/lib/queries.ts` to `Changed files expected` so the barrel exports the new function before allowing `@/lib/queries`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:41:07Z, so the loop context is current.
- Repository context check: `web/src/app/sessions/[sessionKey]/page.tsx` currently imports `getSessionDriverPace` and `getSessionStintTimeline` from `@/lib/queries/sessions`, and the only barrel file is `web/src/lib/queries.ts`.

## Plan-audit verdict (round 5)

**Status: APPROVED**

### High
(none)

### Medium
(none)

### Low
(none)

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:41:07Z, so the loop context is current.
- Prior-context artifacts `web/scripts/tests/session-detail-stint-timeline.test.mjs` and `web/scripts/tests/session-detail-pace-table.test.mjs` exist and support the plan's grading-test pattern claims.
- Step 3 and Acceptance G3 now consistently require `getSessionStrategySummary` to import from `@/lib/queries/sessions`, so no barrel export change is implied and `Changed files expected` remains internally consistent.
