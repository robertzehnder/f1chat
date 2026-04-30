---
slice_id: 10-session-detail-stint-timeline
phase: 10
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T17:39:44-04:00
---

## Goal
Add a stint-timeline visualization (Gantt-style horizontal bars per
driver/stint) to the session-detail page, sourced from the Phase 3
`core.stint_summary` contract.

## Inputs
- `web/src/app/sessions/[sessionKey]/page.tsx`
- `web/src/lib/queries/sessions.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10 (item 1: "stint timeline … backed by `core.*_mat`")
- `sql/011_stint_summary_mat.sql` (column list of the underlying `core.stint_summary` view → `core.stint_summary_mat`)
- `web/src/app/sessions/[sessionKey]/PaceTable.tsx` (sister slice — established pattern for server-component + source-string test gating)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/10-session-detail-pace-table.md` (the established template this slice follows: query function, server component, page wire-up, source-assertion test under `bash scripts/loop/test_grading_gate.sh`)
- `web/scripts/tests/session-detail-pace-table.test.mjs` (the concrete source-string test pattern this slice mirrors)

## Required services / env
- The `bash scripts/loop/test_grading_gate.sh` gate runs `node --test scripts/tests/*.test.mjs`. The test added by this slice is a **source-string assertion** test (no DB / network) following the pattern of `web/scripts/tests/session-detail-pace-table.test.mjs`, so no DB env is required at gate time.
- `cd web && npm run build` and `cd web && npm run typecheck` run statically and require no DB.
- The page itself reads `core.stint_summary` at request time; rendering it in a real browser additionally requires the standard repo DB env (`POSTGRES_URL` / `*_DATABASE_URL` / `NEON_DB_HOST` per `web/src/lib/db.ts`). Live render-against-DB is **not** part of the gate; it is only required for an optional manual smoke check.

## Steps
1. Add `getSessionStintTimeline(sessionKey: number)` to `web/src/lib/queries/sessions.ts` that selects `driver_number, driver_name, team_name, stint_number, compound_name, lap_start, lap_end, tyre_age_at_start, fresh_tyre, stint_length_laps, lap_count, valid_lap_count, avg_lap, best_lap, avg_valid_lap, best_valid_lap, degradation_per_lap` from `core.stint_summary` filtered by `session_key`, ordered by `driver_number ASC, stint_number ASC`.
2. Add a server component `web/src/app/sessions/[sessionKey]/StintTimeline.tsx` (no client hooks; no new charting libs; styled with inline `style={{...}}` so we do not add CSS files). The component takes `rows: Record<string, unknown>[]` from step 1 and:
   - Computes `maxLap = Math.max(1, ...rows.map(r => Number(r.lap_end ?? 0)))` once.
   - Groups rows by `driver_number` (preserving the SQL order so each driver's stints render in stint_number order).
   - For the empty-rows case renders a `<section className="card">` containing `<h3>Stint Timeline</h3>` and a `<p className="muted">` empty message (mirrors `DataTable.tsx:8-15`).
   - For the non-empty case renders one outer `<section className="card">` with `<h3>Stint Timeline</h3>`, then a per-driver `<div data-testid="stint-row">` containing a label (driver_number / driver_name / team_name) and a track `<div data-testid="stint-track">` of per-stint bars `<div data-testid="stint-bar">`.
   - Each bar is a **self-closing JSX element** of the form `<div data-testid="stint-bar" title={<expr>} style={{ ... }} />`, where `data-testid="stint-bar"` is the **first** attribute and `title={...}` is the **second** attribute (this attribute order is what Step 4 G2 relies on to brace-extract the title expression). The `style` prop sets `left = ((Number(lap_start) - 1) / maxLap) * 100` and `width = (Number(stint_length_laps) / maxLap) * 100` (clamped to non-negative), expressed as `left: '<pct>%'` / `width: '<pct>%'`.
   - The `title={<expr>}` prop's expression must reference **both** `compound_name` **and** `stint_length_laps` from the row (e.g. `` title={`${row.compound_name} • ${row.stint_length_laps} laps`} ``). Both names must appear as substrings inside that single JSX expression — this is the observable proof that the bar's hover tooltip actually binds those two stint descriptors, and Step 4 G2 enforces it via brace-balanced extraction of the `title={...}` expression rather than via separate file-wide substring matches.
   - Bar background color is keyed off `compound_name` (e.g. `SOFT`/`MEDIUM`/`HARD`/`INTERMEDIATE`/`WET`) via a small literal mapping inside the component; unknown compounds fall back to a neutral grey.
3. Wire it into `web/src/app/sessions/[sessionKey]/page.tsx`: import `getSessionStintTimeline` and `StintTimeline`, add the `getSessionStintTimeline(key)` call as the **last** entry in the existing `Promise.all([...])` argument array, destructure its awaited result as `stints` so that `stints` is the **final identifier** in the destructure pattern (i.e. `const [..., stints] = await Promise.all([..., getSessionStintTimeline(key)])`), and render `<StintTimeline rows={stints} />` inside the existing layout. The "final identifier" requirement is what Step 4's regex `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` enforces (it captures only the identifier immediately before the closing `]`), so positioning `stints` last is required for the source-string wiring test to pass. Place the `<StintTimeline rows={stints} />` element **after** `<PaceTable rows={pace} />` and **before** the existing weather/race-control `two-col` block, so the visualization appears between the per-driver pace card and the environmental data.
4. Add an automated source-assertion test at `web/scripts/tests/session-detail-stint-timeline.test.mjs` (pattern: `web/scripts/tests/session-detail-pace-table.test.mjs`) that uses `node:fs.readFileSync` + `node:assert/strict` to assert five observable groups:
   - **G1 (query shape).** `web/src/lib/queries/sessions.ts` source contains `export async function getSessionStintTimeline`. Extract that function's body via brace-matching (mirroring the sister test's `extractFunctionBody` helper). The body must include `FROM core.stint_summary` and `WHERE session_key = $1`, must NOT reference `raw.stints` (Phase 10 contract requirement: read the materialized `core.*` contract, not the raw layer), and must contain every column listed in Step 1 — `driver_number`, `driver_name`, `team_name`, `stint_number`, `compound_name`, `lap_start`, `lap_end`, `tyre_age_at_start`, `fresh_tyre`, `stint_length_laps`, `lap_count`, `valid_lap_count`, `avg_lap`, `best_lap`, `avg_valid_lap`, `best_valid_lap`, `degradation_per_lap`. The test iterates the column list and asserts each as a substring, so the SELECT-shape stays in lock-step with Step 1.
   - **G2 (Gantt-style component with bound title binding).** `web/src/app/sessions/[sessionKey]/StintTimeline.tsx` exists and exports a default function (regex `/export\s+default\s+function\b/`). The source must contain all of these literal substrings: `data-testid="stint-row"`, `data-testid="stint-bar"`, `lap_start`, `stint_length_laps`, `compound_name` — together these are the substring-level proof that the component is a Gantt-style per-stint visualization (rows + bars positioned by `lap_start` / `stint_length_laps`, colored by `compound_name`) rather than a tabular fall-back. The test must fail if any of the five substrings is missing. **Beyond the substring presence**, the test must also extract the bar's `title={...}` JSX expression and assert both `compound_name` and `stint_length_laps` are bound inside it, via the following deterministic procedure (mirroring the brace-balanced `extractFunctionBody` helper in the sister test): (i) `barIdx = src.indexOf('data-testid="stint-bar"')` — assert ≥ 0; (ii) `closeIdx = src.indexOf('/>', barIdx)` — assert ≥ 0 (this is what Step 2's "self-closing element" requirement guarantees); (iii) inside the `[barIdx, closeIdx)` window, locate `title={` (assert present — this is what Step 2's "second attribute" ordering guarantees); (iv) starting at the `{` of that `title={`, walk forward through the **full source** balancing `{`/`}` until the matching outer `}` is found and slice out the inner expression (this handles JSX template-literal expressions like `` `${row.compound_name} • ${row.stint_length_laps} laps` `` whose internal `${...}` openers would otherwise confuse a non-brace-aware regex); (v) assert the extracted expression contains both `compound_name` AND `stint_length_laps` as substrings. The brace-balanced extraction of the `title` expression is the observable check that those two stint descriptors are bound to the bar's hover tooltip — separate file-wide substring matches are explicitly **not** sufficient (e.g., a `compound_name` reference inside the color-mapping helper would otherwise satisfy a naive substring check without proving the title is bound).
   - **G3 (page → component shared-identifier wiring).** `web/src/app/sessions/[sessionKey]/page.tsx` source must (a) import `getSessionStintTimeline` from `@/lib/queries` or the sessions submodule — regex `/import\s*\{[^}]*\bgetSessionStintTimeline\b[^}]*\}\s*from\s*["']@\/lib\/queries(?:\/sessions)?["']/`; (b) bind the awaited query result to the `<StintTimeline>` `rows` prop via a **shared identifier** — extract a destructured identifier with `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` (capture group 1 — the **last** name in the Promise.all destructure, which Step 3 fixes as `stints`); (c) assert the matched `Promise.all` argument list contains `getSessionStintTimeline(` (regex `/await\s+Promise\.all\(\[[\s\S]*?getSessionStintTimeline\(/`); (d) assert the literal `<StintTimeline rows={<captured>}` appears in the same source, where `<captured>` is interpolated from capture group 1 of the destructure regex. The destructure-regex match, the inner-`Promise.all`-call regex match, and the interpolated `<StintTimeline rows={<captured>}` substring being present together are the observable proof that the same awaited `getSessionStintTimeline(...)` result is the value passed into `<StintTimeline rows={...}/>`. Two independent substring assertions (one for the call site, one for `rows={`) are explicitly **not** sufficient and the test must fail if the destructure regex captures nothing or the captured identifier does not appear inside `<StintTimeline rows={...}`.
   - **G4 (component sibling-import pin).** `page.tsx` source must contain a default-import of `StintTimeline` from the sibling component path — regex `/import\s+StintTimeline\s+from\s+["']\.\/StintTimeline["']/`. This pins the sibling module path so the wire-up cannot accidentally re-route through an unrelated re-export.
   - **G5 (page placement order).** `page.tsx` source must place `<StintTimeline rows={<captured>} />` (where `<captured>` is the identifier from G3's destructure capture) **after** `<PaceTable rows={pace}` and **before** the existing weather/race-control `two-col` block. The test computes three indices via `String.prototype.indexOf`: `idxPace = src.indexOf('<PaceTable rows={pace}')`, `idxStint = src.indexOf('<StintTimeline rows={' + captured + '}')`, and `idxWeather = src.indexOf('Weather Preview')`. All three must be ≥ 0 (assert each), and the strict ordering `idxPace < idxStint && idxStint < idxWeather` must hold. `'Weather Preview'` is the unique title text on the existing `<DataTable title="Weather Preview" ...>` rendered inside the second `<div className="two-col">` block (see `page.tsx:71`), so its index is the deterministic "start of the weather/race-control two-col block" marker. This is the observable check that Step 3's placement claim — "render `<StintTimeline rows={stints} />` after `<PaceTable rows={pace} />` and before the existing weather/race-control `two-col` block" — actually holds in the wired-up page.

## Changed files expected
- `web/src/lib/queries/sessions.ts` (new exported function `getSessionStintTimeline`)
- `web/src/app/sessions/[sessionKey]/StintTimeline.tsx` (new file)
- `web/src/app/sessions/[sessionKey]/page.tsx` (wire-up edits)
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` (new file)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `cd web && npm run build` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs `scripts/loop/state/test_grading_baseline.txt`); the new `session-detail-stint-timeline.test.mjs` is part of the run and passes.
- [ ] All five assertion groups (G1–G5) inside `web/scripts/tests/session-detail-stint-timeline.test.mjs` (listed in Step 4) pass — together they are the observable check that (a) the page is wired to `core.stint_summary` rather than to `raw.stints`, (b) `StintTimeline` is a Gantt-style per-stint visualization (presence of `data-testid="stint-row"` / `data-testid="stint-bar"` plus references to `lap_start`, `stint_length_laps`, `compound_name`) **and the bar's `title={...}` expression — extracted by brace-balanced walk per G2 — actually binds both `compound_name` and `stint_length_laps`, not merely that those names appear somewhere else in the file**, (c) the awaited `getSessionStintTimeline(...)` result is the value passed into `<StintTimeline rows={...}>` via a shared destructured identifier — not via two independent substring matches, and (d) per G5, `<StintTimeline rows={...}>` is rendered **after** `<PaceTable rows={pace} />` and **before** the existing weather/race-control `two-col` block (deterministic `indexOf` ordering of `<PaceTable rows={pace}`, `<StintTimeline rows={<captured>}`, and `Weather Preview`), proving Step 3's placement claim.
- [ ] The `getSessionStintTimeline` SQL string in `web/src/lib/queries/sessions.ts` contains every column listed in Step 1; this is enforced by the per-column substring loop in G1, so the test and this criterion are the same observable check.
- [ ] `page.tsx` binds the awaited `getSessionStintTimeline(...)` result to `<StintTimeline rows={...}>` through a **shared identifier** captured from the `Promise.all` destructure — not via two independent substring matches. This is enforced by G3 as described in Step 4 (destructure regex captures the final identifier, the matched Promise.all arg list contains `getSessionStintTimeline(`, and the captured identifier appears in `<StintTimeline rows={<captured>}`).

## Out of scope
- Per-driver pace table — covered by sibling slice `10-session-detail-pace-table.md` (already merged).
- Strategy summary block — covered by sibling slice `10-session-detail-strategy-summary.md`.
- Adding new columns to `core.stint_summary_mat`.
- Modifying `core.stint_summary` view or the `core_build` source-definition layer.
- Client-side interactivity (hover-to-zoom, drag-to-scrub, etc.); the component is server-rendered with static inline styles only.
- Adopting a charting library (d3, Recharts, vis.js, etc.) — the Gantt visualization is plain HTML/CSS so no new dependency is added.

## Risk / rollback
Rollback: `git revert <commit>`. The change is additive (new query function, new component, new test, one wire-up in `page.tsx`); reverting restores the prior page render.

## Decisions
- **Test strategy.** The repo's only automated UI-adjacent gate is `node --test scripts/tests/*.test.mjs` (no Playwright, no RTL setup). Existing precedents (`session-detail-pace-table.test.mjs`, `db-stmt-cache.test.mjs`, `prompt-prefix-split.test.mjs`) assert structural properties via source-string reads. We follow that pattern instead of introducing a new test runner. This is what addresses the round-1 Medium item that called out "Playwright/RTL tests if the project has any … fallback screenshot" as not verifying the goal.
- **Route path.** The actual session-detail route is `web/src/app/sessions/[sessionKey]/page.tsx`. The seed plan's `web/src/app/sessions/[id]/...` paths in `Changed files expected` were wrong; this revision uses `[sessionKey]` throughout.
- **Contract choice (round-1 Medium-3).** The named Phase 3 semantic contract this slice consumes is `core.stint_summary` — a thin view over `core.stint_summary_mat` (see `sql/011_stint_summary_mat.sql:54-55`), itself a Phase 3 materialization. It carries every column this slice needs (`stint_number`, `compound_name`, `lap_start`, `lap_end`, `tyre_age_at_start`, `fresh_tyre`, `stint_length_laps`, plus pace metrics). Going through the public view rather than `_mat` directly keeps us aligned with the Phase 3 facade pattern and matches what the sister `10-session-detail-pace-table` slice does for `core.driver_session_summary`.
- **Visualization shape.** A Gantt-style horizontal-bar layout (one `data-testid="stint-row"` per driver, one `data-testid="stint-bar"` per stint, width proportional to `stint_length_laps`, colored by `compound_name`) implemented with plain divs and inline styles. We do not add a charting library because the goal is one fixed-shape visualization, not a generic charting surface.
- **Gate command (round-1 High).** Switched from raw `cd web && npm run test:grading` to `bash scripts/loop/test_grading_gate.sh` per the loop policy lesson recorded in `diagnostic/_state.md` (slice:08-synthesis-payload-cutover): the wrapper diffs failures against `scripts/loop/state/test_grading_baseline.txt` so pre-existing integration failures do not auto-REJECT.

## Slice-completion note

**Branch:** `slice/10-session-detail-stint-timeline` (based on `cc24a3f` — plan-approved tip).

**Changes (matches Changed files expected exactly):**
- `web/src/lib/queries/sessions.ts` — added `export async function getSessionStintTimeline(sessionKey: number)` selecting all 17 columns from Step 1 from `core.stint_summary` filtered by `WHERE session_key = $1`, ordered `driver_number ASC, stint_number ASC`.
- `web/src/app/sessions/[sessionKey]/StintTimeline.tsx` — new server component (no `"use client"`, no hooks, no charting libs, inline `style={{...}}` only). Empty-rows path renders a `<section className="card"><h3>Stint Timeline</h3><p className="muted">…</p></section>`. Non-empty path computes `maxLap = Math.max(1, ...rows.map(r => Number(r.lap_end ?? 0)))`, groups rows by `driver_number` preserving SQL order, and renders one `data-testid="stint-row"` per driver containing a label and a `data-testid="stint-track"` whose children are self-closing `<div data-testid="stint-bar" title={\`${row.compound_name} • ${row.stint_length_laps} laps\`} style={{...}} />` bars (data-testid first, title second, per Step 2 attribute-order requirement). Bar `left` / `width` are clamped non-negative percentages of `maxLap`. Compound color mapping is a literal record `SOFT/MEDIUM/HARD/INTERMEDIATE/WET` with neutral grey fallback.
- `web/src/app/sessions/[sessionKey]/page.tsx` — added `getSessionStintTimeline` to the existing `from "@/lib/queries/sessions"` import (matches G3 regex's `@/lib/queries/sessions` arm), added a default import `import StintTimeline from "./StintTimeline"` (G4), appended `getSessionStintTimeline(key)` as the **last** entry in `Promise.all([...])` and destructured the result as `stints` so `stints` is the **final** identifier in the destructure pattern (G3 regex captures the last name before `]`), and rendered `<StintTimeline rows={stints} />` directly **after** `<PaceTable rows={pace} />` and **before** the existing weather/race-control `two-col` block (G5 ordering).
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` — new source-string assertion test mirroring `session-detail-pace-table.test.mjs`. Implements the five assertion groups exactly as specified in Step 4: G1 column substring loop over the 17 columns + `FROM core.stint_summary` + `WHERE session_key = $1` + `!body.includes("raw.stints")`; G2 substring presence + brace-balanced extraction of the bar's `title={...}` JSX expression (using `extractBraceExpression` walking `{`/`}` from the opening `{` of `title={`) and asserting both `compound_name` and `stint_length_laps` are inside that extracted expression; G3 import regex + `Promise.all` destructure capture + `Promise.all([...])` arg-list call regex + interpolated `<StintTimeline rows={<captured>}` substring; G4 sibling-import regex `/import\s+StintTimeline\s+from\s+["']\.\/StintTimeline["']/`; G5 deterministic `indexOf` ordering of `<PaceTable rows={pace}` < `<StintTimeline rows={<captured>}` < `Weather Preview`.

**Decisions (no scope drift from approved plan):**
- Imported `getSessionStintTimeline` from `@/lib/queries/sessions` directly (sister `getSessionDriverPace` does the same). Step 4 G3 regex accepts either `@/lib/queries` or `@/lib/queries/sessions`, so no edit to `web/src/lib/queries.ts` was needed and that file is therefore not touched (kept out of "Changed files expected").
- Compound→color mapping kept as an in-file literal record per Step 2; no shared module added (Out-of-scope guard against new abstractions).
- The bar `title` is a template literal `` `${row.compound_name} • ${row.stint_length_laps} laps` `` so the brace-balanced extraction in G2 is the right shape (a plain regex would have been fooled by the inner `${...}` openers, which is exactly what Step 4 G2 calls out).

**Gate exit codes (run from `/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline`):**
- `cd web && npm run typecheck` → exit 0.
- `cd web && npm run build` → exit 0 (Next.js 15 build, all 21 routes compiled including `/sessions/[sessionKey]`).
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`). The new `session-detail-stint-timeline.test.mjs` runs as part of `node --test scripts/tests/*.test.mjs` and all five subtests (G1–G5) pass.

**Self-checks:**
- `git status` shows only the four files in "Changed files expected" plus the slice-file frontmatter/completion-note edit.
- The `Promise.all` destructure regex `/const\s+\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` matched against the new `page.tsx` captures `stints` (the final identifier), and the rendered element is `<StintTimeline rows={stints} />` — confirmed by running G3 in isolation against the post-edit source.
- `<StintTimeline rows={stints} />` index in `page.tsx` lies strictly between `<PaceTable rows={pace}` and the literal `Weather Preview` (G5 holds).
- The `title={...}` brace-balanced extraction over the new `StintTimeline.tsx` yields the expression `` `${row.compound_name} • ${row.stint_length_laps} laps` `` which contains both `compound_name` and `stint_length_laps` substrings (G2's tooltip-binding assertion holds).

## Audit verdict
**Status: PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS. `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/10-session-detail-stint-timeline.md` plus `web/scripts/tests/session-detail-stint-timeline.test.mjs`, `web/src/app/sessions/[sessionKey]/StintTimeline.tsx`, `web/src/app/sessions/[sessionKey]/page.tsx`, and `web/src/lib/queries/sessions.ts`.
- Criterion: `getSessionStintTimeline` selects all required columns from `core.stint_summary`, filters `WHERE session_key = $1`, and avoids `raw.stints` -> PASS ([web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/lib/queries/sessions.ts:330), [web/scripts/tests/session-detail-stint-timeline.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/scripts/tests/session-detail-stint-timeline.test.mjs:58)).
- Criterion: `StintTimeline` is a server component with empty-state card, grouped stint rows, self-closing `data-testid="stint-bar"` bars, `title={...}` binding for both `compound_name` and `stint_length_laps`, and lap-based inline positioning -> PASS ([web/src/app/sessions/[sessionKey]/StintTimeline.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/app/sessions/[sessionKey]/StintTimeline.tsx:17), [web/src/app/sessions/[sessionKey]/StintTimeline.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/app/sessions/[sessionKey]/StintTimeline.tsx:67), [web/scripts/tests/session-detail-stint-timeline.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/scripts/tests/session-detail-stint-timeline.test.mjs:89)).
- Criterion: `page.tsx` imports `getSessionStintTimeline` and `StintTimeline`, appends `getSessionStintTimeline(key)` as the last `Promise.all` entry, binds the final destructured identifier `stints`, and renders `<StintTimeline rows={stints} />` after `<PaceTable rows={pace} />` and before `Weather Preview` -> PASS ([web/src/app/sessions/[sessionKey]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/app/sessions/[sessionKey]/page.tsx:10), [web/src/app/sessions/[sessionKey]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/app/sessions/[sessionKey]/page.tsx:31), [web/src/app/sessions/[sessionKey]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/src/app/sessions/[sessionKey]/page.tsx:71), [web/scripts/tests/session-detail-stint-timeline.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/scripts/tests/session-detail-stint-timeline.test.mjs:141), [web/scripts/tests/session-detail-stint-timeline.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/scripts/tests/session-detail-stint-timeline.test.mjs:176)).
- Criterion: all five assertion groups G1-G5 pass in the added source-string test -> PASS (`cd web && node --test scripts/tests/session-detail-stint-timeline.test.mjs` exit `0`; [web/scripts/tests/session-detail-stint-timeline.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-session-detail-stint-timeline/web/scripts/tests/session-detail-stint-timeline.test.mjs:58)).
- Decision -> PASS. Slice meets scope and acceptance criteria.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the declared gate matches loop policy and does not fail on known baseline grading cases.

### Medium
- [x] Rewrite Step 3 and the acceptance criteria to require a deterministic automated check for the stint timeline; `if the project has any` plus a fallback screenshot does not verify the goal or the contract-parity claim.
- [x] Add the expected test file and any artifact path the plan intends to create, or remove the screenshot path entirely; the current Changed files expected / Artifact paths blocks do not cover Step 3.
- [x] Name the concrete Phase 3 semantic contract source this slice will consume so Step 2 is auditable and the implementer is not left to guess which contract defines stint data.

### Low
- [x] Tighten `Page renders without runtime errors` into a command- or assertion-based acceptance criterion tied to the declared gates.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:15:31Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Align Step 2, Step 4 G2, and the matching acceptance wording so the automated check proves the bars actually expose the promised stint descriptors; either assert a concrete observable binding for `compound_name` and `stint_length_laps` (for example the `title` content or equivalent rendered text) or narrow the plan so it no longer claims those values are cited in visible/accessible bar content.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:15:31Z, so no staleness note applies.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Align Step 3 with Step 4/G3 or the acceptance criteria so the automated checks prove `<StintTimeline rows={stints} />` is rendered after `<PaceTable rows={pace} />` and before the existing weather/race-control `two-col` block, or narrow Step 3 so it no longer makes that placement claim.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:15:31Z, so no staleness note applies.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:15:31Z, so no staleness note applies.
