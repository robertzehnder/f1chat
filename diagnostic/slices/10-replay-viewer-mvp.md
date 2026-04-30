---
slice_id: 10-replay-viewer-mvp
phase: 10
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:22:27-04:00
---

## Goal
Add a basic race-replay viewer (positions over time, per-lap snapshots)
backed by the Phase 3 `core.race_progression_summary` and
`core.replay_lap_frames` semantic contracts, mounted at
`/replay/[sessionId]`.

## Inputs
- `web/src/app/sessions/[sessionKey]/page.tsx` (template for server-component layout + `Promise.all` data-fetch wiring)
- `web/src/lib/queries/sessions.ts` (location for the new query function)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10 item 4 (verbatim: "Replay viewer: use `core.replay_lap_frames` and `core.race_progression_summary`")
- `sql/006_semantic_lap_layer.sql` lines 501–546 (`core.replay_lap_frames` view definition — column list)
- `sql/007_semantic_summary_contracts.sql` lines 333–397 (`core.race_progression_summary` view definition — column list)
- `sql/013_race_progression_summary_mat.sql` lines 18–46 (`core.race_progression_summary_mat` materialized table column list — what the view selects from)
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` (source-string assertion test pattern this slice mirrors)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/10-session-detail-stint-timeline.md` (the established sibling-slice template: query function + server component + page wire-up + source-assertion test under `bash scripts/loop/test_grading_gate.sh`)
- `web/scripts/tests/session-detail-pace-table.test.mjs` (the original source-string test pattern; defines the `extractFunctionBody` brace-matching helper this slice's test reuses)

## Required services / env
- The `bash scripts/loop/test_grading_gate.sh` gate runs `node --test scripts/tests/*.test.mjs`. The test added by this slice is a **source-string assertion** test (no DB / network) following the pattern of `web/scripts/tests/session-detail-stint-timeline.test.mjs`, so no DB env is required at gate time.
- `cd web && npm run build` and `cd web && npm run typecheck` run statically and require no DB.
- The page itself reads `core.race_progression_summary` and `core.replay_lap_frames` at request time; rendering it in a real browser additionally requires the standard repo DB env (`POSTGRES_URL` / `*_DATABASE_URL` / `NEON_DB_HOST` per `web/src/lib/db.ts`). Live render-against-DB is **not** part of the gate; it is only required for an optional manual smoke check.

## Steps
1. Add `getSessionRaceProgression(sessionKey: number)` to `web/src/lib/queries/sessions.ts` that selects `driver_number, driver_name, team_name, lap_number, frame_time, position_end_of_lap, previous_position, positions_gained_this_lap, opening_position, latest_position, best_position, worst_position` from `core.race_progression_summary` filtered by `session_key = $1`, ordered by `lap_number ASC, position_end_of_lap ASC NULLS LAST`. Return type `Promise<Record<string, unknown>[]>` (mirrors the sister `getSessionStintTimeline` exported from the same file).
2. Add `getSessionReplayFrames(sessionKey: number)` to the same `web/src/lib/queries/sessions.ts` that selects `lap_number, frame_time, leader_driver_number, leader_position, best_valid_lap_on_lap, avg_valid_lap_on_lap, weather_track_temperature, weather_air_temperature, race_control_flag` from `core.replay_lap_frames` filtered by `session_key = $1`, ordered by `lap_number ASC`. Return type `Promise<Record<string, unknown>[]>`.
3. Add a server component `web/src/app/replay/[sessionId]/ReplayViewer.tsx` (no client hooks; no new charting libs; styled with inline `style={{...}}` so we do not add CSS files). It takes two props — `progression: Record<string, unknown>[]` (output of step 1) and `frames: Record<string, unknown>[]` (output of step 2) — and:
   - For the empty-`progression` case renders a `<section className="card">` containing `<h2>Replay Viewer</h2>` and a `<p className="muted">` empty message ("No replay frames available for this session.").
   - For the non-empty case renders one outer `<section className="card">` with `<h2>Replay Viewer</h2>`, then:
     - Computes `maxLap = Math.max(1, ...progression.map(r => Number(r.lap_number ?? 0)))` once.
     - Computes `numDrivers = Math.max(1, new Set(progression.map(r => Number(r.driver_number))).size)` once. This is the denominator used to derive each row's vertical position from `position_end_of_lap`.
     - Groups rows by `driver_number` (preserving the SQL order so each driver's lap rows render in lap_number order).
     - Renders a per-driver `<div data-testid="replay-driver-row">` containing a label (driver_number / driver_name / team_name) and a track `<div data-testid="replay-track">` of per-lap markers `<div data-testid="replay-lap-marker">`.
     - Each marker is a **self-closing JSX element** of the form `<div data-testid="replay-lap-marker" title={<expr>} style={{ ... }} />`, where `data-testid="replay-lap-marker"` is the **first** attribute and `title={...}` is the **second** attribute (this attribute order is what Step 5 G2 relies on to brace-extract the title expression). The `style` prop sets `left = ((Number(lap_number) - 1) / maxLap) * 100`, expressed as `left: '<pct>%'`, and `top = ((Number(position_end_of_lap) - 1) / numDrivers) * 100`, expressed as `top: '<pct>%'` (clamped to non-negative). The denominator `numDrivers` is what makes this an actual "positions-over-time" mapping rather than a constant offset.
     - The `title={<expr>}` prop's expression must reference **both** `lap_number` **and** `position_end_of_lap` from the row (e.g. `` title={`Lap ${row.lap_number} • P${row.position_end_of_lap}`} ``). Both names must appear as substrings inside that single JSX expression — this is the observable proof that the marker's hover tooltip actually binds those two replay-frame descriptors, and Step 5 G2 enforces it via brace-balanced extraction of the `title={...}` expression rather than via separate file-wide substring matches.
     - After the per-driver tracks, renders a per-lap frames strip `<div data-testid="replay-frame-strip">` whose children are `<div data-testid="replay-frame">` elements (one per row of `frames`), each annotated with the lap leader and any active flag. The frame element must reference `leader_driver_number` and `race_control_flag` from the corresponding `frames` row inside its body or `title` attribute (Step 5 G3 enforces this via substring presence).
4. Wire it into a new page `web/src/app/replay/[sessionId]/page.tsx` (new server component, mirrors the structure of `web/src/app/sessions/[sessionKey]/page.tsx`):
   - `export const dynamic = "force-dynamic";`.
   - `export default async function ReplayPage({ params }: { params: Promise<{ sessionId: string }> })`.
   - Parse `sessionId` to a `Number`; if `!Number.isFinite(key)` return a `<section className="card"><h2>Invalid session id</h2></section>` early.
   - Import `getSessionRaceProgression` and `getSessionReplayFrames` from `@/lib/queries/sessions` and `ReplayViewer` from `./ReplayViewer`.
   - Inside the function body, the awaited Promise.all destructure must take the form `const [progression, frames] = await Promise.all([getSessionRaceProgression(key), getSessionReplayFrames(key)])` so that the **last** identifier in the destructure (Step 5 G4 captures it) is `frames` and `getSessionReplayFrames(` appears inside the `Promise.all` argument list.
   - Render `<ReplayViewer progression={progression} frames={frames} />` inside an outer `<div className="stack">` with a `<section className="hero"><h1>Replay · Session {String(key)}</h1></section>` header preceding the viewer. The literal `<ReplayViewer progression={progression} frames={frames} />` substring must appear in the source — Step 5 G4 asserts both prop bindings against the captured destructure identifier (`frames`) and the matching first identifier (`progression`).
5. Add an automated source-assertion test at `web/scripts/tests/replay-viewer-mvp.test.mjs` (pattern: `web/scripts/tests/session-detail-stint-timeline.test.mjs`) that uses `node:fs.readFileSync` + `node:assert/strict` + the `extractFunctionBody` brace-matching helper from the sister test to assert five observable groups:
   - **G1 (race-progression query shape).** `web/src/lib/queries/sessions.ts` source contains `export async function getSessionRaceProgression`. Extract that function's body via brace-matching. The body must include `FROM core.race_progression_summary` and `WHERE session_key = $1`, must NOT reference `raw.laps` or `raw.position_history` (Phase 10 contract requirement: read the materialized `core.*` contract, not the raw layer), and must contain every column listed in Step 1 — `driver_number`, `driver_name`, `team_name`, `lap_number`, `frame_time`, `position_end_of_lap`, `previous_position`, `positions_gained_this_lap`, `opening_position`, `latest_position`, `best_position`, `worst_position`. The test iterates the column list and asserts each as a substring, so the SELECT-shape stays in lock-step with Step 1.
   - **G2 (replay-frames query shape + Replay viewer with bound title binding).**
     - Sub-G2a: `sessions.ts` source contains `export async function getSessionReplayFrames`. Extract its body. The body must include `FROM core.replay_lap_frames` and `WHERE session_key = $1`, must NOT reference `raw.weather` or `raw.race_control` (Phase 10: read the contract, not the raw layer), and must contain every column listed in Step 2 — `lap_number`, `frame_time`, `leader_driver_number`, `leader_position`, `best_valid_lap_on_lap`, `avg_valid_lap_on_lap`, `weather_track_temperature`, `weather_air_temperature`, `race_control_flag`.
     - Sub-G2b: `web/src/app/replay/[sessionId]/ReplayViewer.tsx` exists and exports a default function (regex `/export\s+default\s+function\b/`). Its source must contain all of these literal substrings: `data-testid="replay-driver-row"`, `data-testid="replay-track"`, `data-testid="replay-lap-marker"`, `lap_number`, `position_end_of_lap`, `numDrivers` — together these are the substring-level proof that the component is a positions-over-time visualization (per-driver rows + per-lap markers positioned by `lap_number` / `position_end_of_lap`, with the vertical axis derived from `numDrivers`) rather than a tabular fallback. The test must fail if any of the six substrings is missing.
     - Sub-G2c: Beyond the substring presence, the test must extract the marker's `title={...}` JSX expression and assert both `lap_number` and `position_end_of_lap` are bound inside it, via the deterministic procedure (mirroring the brace-balanced `extractFunctionBody` helper): (i) `markerIdx = src.indexOf('data-testid="replay-lap-marker"')` — assert ≥ 0; (ii) `closeIdx = src.indexOf('/>', markerIdx)` — assert ≥ 0 (this is what Step 3's "self-closing element" requirement guarantees); (iii) inside the `[markerIdx, closeIdx)` window, locate `title={` (assert present — this is what Step 3's "second attribute" ordering guarantees); (iv) starting at the `{` of that `title={`, walk forward through the **full source** balancing `{`/`}` until the matching outer `}` is found and slice out the inner expression (this handles JSX template-literal expressions like `` `Lap ${row.lap_number} • P${row.position_end_of_lap}` `` whose internal `${...}` openers would otherwise confuse a non-brace-aware regex); (v) assert the extracted expression contains both `lap_number` AND `position_end_of_lap` as substrings. The brace-balanced extraction is the observable check that those two replay-frame descriptors are bound to the marker's hover tooltip — separate file-wide substring matches are explicitly **not** sufficient.
   - **G3 (frames strip references contract columns).** `ReplayViewer.tsx` source must contain `data-testid="replay-frame-strip"`, `data-testid="replay-frame"`, `leader_driver_number`, and `race_control_flag` as substrings. This is the observable check that Step 3's claim about the per-lap frames strip — "annotated with the lap leader and any active flag" — actually binds those columns from the `frames` rows.
   - **G4 (page → component shared-identifier wiring).** `web/src/app/replay/[sessionId]/page.tsx` source must:
     - (a) import `getSessionRaceProgression` and `getSessionReplayFrames` from `@/lib/queries/sessions` — regex `/import\s*\{[^}]*\bgetSessionRaceProgression\b[^}]*\bgetSessionReplayFrames\b[^}]*\}\s*from\s*["']@\/lib\/queries\/sessions["']/` (the regex requires both names in the same import clause and pins the sessions submodule path).
     - (b) bind the awaited Promise.all results to the `<ReplayViewer>` props via **shared identifiers** — extract the first and last destructured identifiers with `/const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(/` (capture groups 1 and 2 — Step 4 fixes them as `progression` and `frames`).
     - (c) assert the matched `Promise.all` argument list contains both `getSessionRaceProgression(` and `getSessionReplayFrames(` (regex `/await\s+Promise\.all\(\[[\s\S]*?getSessionRaceProgression\([\s\S]*?getSessionReplayFrames\(/`).
     - (d) assert the literal `<ReplayViewer progression={<group1>} frames={<group2>}` appears in the same source, where `<group1>` and `<group2>` are interpolated from the destructure capture. Two independent substring assertions (one for `progression={`, one for `frames={`) are explicitly **not** sufficient — the test must interpolate the captured identifiers from the destructure regex so the wire-up cannot drift to unrelated names.
     - (e) assert a default-import of `ReplayViewer` from the sibling component path — regex `/import\s+ReplayViewer\s+from\s+["']\.\/ReplayViewer["']/`.
   - **G5 (ordering inside page).** `page.tsx` source must place the `<ReplayViewer progression={<group1>} frames={<group2>}` rendered element **after** the `<section className="hero"` open. The test computes `idxHero = src.indexOf('<section className="hero"')`, `idxViewer = src.indexOf('<ReplayViewer progression={' + group1 + '} frames={' + group2 + '}')`. Both must be ≥ 0 (assert each), and the strict ordering `idxHero < idxViewer` must hold.

## Changed files expected
- `web/src/lib/queries/sessions.ts` (two new exported functions: `getSessionRaceProgression`, `getSessionReplayFrames`)
- `web/src/app/replay/[sessionId]/ReplayViewer.tsx` (new file — server component)
- `web/src/app/replay/[sessionId]/page.tsx` (new file — server component page)
- `web/scripts/tests/replay-viewer-mvp.test.mjs` (new file — source-string assertion test)

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
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs `scripts/loop/state/test_grading_baseline.txt`); the new `web/scripts/tests/replay-viewer-mvp.test.mjs` is part of the run and passes.
- [ ] All five assertion groups (G1–G5) inside `web/scripts/tests/replay-viewer-mvp.test.mjs` (listed in Step 5) pass — together they are the observable check that (a) the page is wired to `core.race_progression_summary` and `core.replay_lap_frames` rather than to `raw.laps` / `raw.position_history` / `raw.weather` / `raw.race_control`, (b) `ReplayViewer` is a positions-over-time visualization (presence of `data-testid="replay-driver-row"` / `data-testid="replay-track"` / `data-testid="replay-lap-marker"` plus references to `lap_number`, `position_end_of_lap`, `numDrivers`) **and the marker's `title={...}` expression — extracted by brace-balanced walk per G2c — actually binds both `lap_number` and `position_end_of_lap`, not merely that those names appear somewhere else in the file**, (c) per G3, the per-lap frames strip references `leader_driver_number` and `race_control_flag` from the `frames` rows, and (d) per G4, the awaited `getSessionRaceProgression(...)` and `getSessionReplayFrames(...)` results are bound into `<ReplayViewer progression={...} frames={...}>` via **shared identifiers** captured from the same Promise.all destructure — not via two independent substring matches.
- [ ] The `getSessionRaceProgression` SQL string in `web/src/lib/queries/sessions.ts` contains every column listed in Step 1; the `getSessionReplayFrames` SQL string contains every column listed in Step 2; both are enforced by per-column substring loops in G1 and G2a, so the test and these criteria are the same observable check.
- [ ] `web/src/app/replay/[sessionId]/page.tsx` binds the awaited `getSessionRaceProgression(...)` and `getSessionReplayFrames(...)` results into `<ReplayViewer progression={...} frames={...}>` through **shared identifiers** captured from the `Promise.all` destructure — not via independent substring matches. This is enforced by G4 as described in Step 5 (destructure regex captures both identifiers, the matched Promise.all arg list contains both call sites, and both captured identifiers appear in `<ReplayViewer progression={<group1>} frames={<group2>}`).

## Out of scope
- Client-side interactivity (drag-to-scrub, play/pause, hover-to-zoom). Component is server-rendered with static inline styles only.
- Charting libraries (recharts / d3 / etc.). Visualization is plain `<div>`s with inline CSS positioning.
- Telemetry-grain replay (per-second `core.car_data` sampling). This slice is lap-grain only.
- Adding new columns to `core.replay_lap_frames`, `core.race_progression_summary`, or `core.race_progression_summary_mat`.
- Modifying source-definition layer in `core_build.*`.
- Cross-session comparison or championship-aggregate replay views.

## Risk / rollback
Rollback: `git revert <commit>`. The slice adds new files (one query function block extending `sessions.ts`, two new app files under `web/src/app/replay/[sessionId]/`, one new test file) and does not modify any existing UI or query, so revert is mechanical and cannot regress sibling Phase 10 surfaces.

## Slice-completion note

**Branch:** `slice/10-replay-viewer-mvp` (will be pushed to `origin/slice/10-replay-viewer-mvp` as the `[slice:10-replay-viewer-mvp][awaiting-audit]` HEAD).

**Commit:** the single `[slice:10-replay-viewer-mvp][awaiting-audit]` commit at the HEAD of `slice/10-replay-viewer-mvp`. Run `git log -1 slice/10-replay-viewer-mvp` to read the hash and full message.

**Files changed (all within declared "Changed files expected" scope):**
- `web/src/lib/queries/sessions.ts` — appended two new exported async functions: `getSessionRaceProgression(sessionKey: number)` selecting all 12 columns from `core.race_progression_summary` filtered by `session_key = $1` and ordered `lap_number ASC, position_end_of_lap ASC NULLS LAST`; and `getSessionReplayFrames(sessionKey: number)` selecting all 9 columns from `core.replay_lap_frames` filtered by `session_key = $1` ordered `lap_number ASC`. Neither references `raw.laps`, `raw.position_history`, `raw.weather`, or `raw.race_control`. Return type is `Promise<Record<string, unknown>[]>` mirroring the sister `getSessionStintTimeline`.
- `web/src/app/replay/[sessionId]/ReplayViewer.tsx` — new server component (no client hooks, no charting libs, only inline `style={{...}}`). Empty `progression` ⇒ `<section className="card"><h2>Replay Viewer</h2><p className="muted">No replay frames available for this session.</p></section>`. Non-empty: computes `maxLap = Math.max(1, ...progression.map((r) => Number(r.lap_number ?? 0)))` and `numDrivers = Math.max(1, new Set(progression.map((r) => Number(r.driver_number))).size)`, groups rows by `driver_number` preserving SQL order, renders one `<div data-testid="replay-driver-row">` per driver with a `<div data-testid="replay-track">` containing self-closing `<div data-testid="replay-lap-marker" title={`Lap ${row.lap_number} • P${row.position_end_of_lap}`} key={idx} style={{...}} />` markers (`data-testid` is the **first** attribute, `title={...}` the **second**). Marker `left` = `((Number(row.lap_number ?? 0) - 1) / maxLap) * 100` expressed as `${...}%`; `top` = `((Number(row.position_end_of_lap ?? 0) - 1) / numDrivers) * 100` expressed as `${...}%`, both clamped non-negative. After the per-driver tracks, renders `<div data-testid="replay-frame-strip">` whose children are `<div data-testid="replay-frame">` elements (one per row of `frames`), each whose body and `title` include `leader_driver_number` and `race_control_flag` literally.
- `web/src/app/replay/[sessionId]/page.tsx` — new server component. `import { getSessionRaceProgression, getSessionReplayFrames } from "@/lib/queries/sessions"` + default-import `ReplayViewer from "./ReplayViewer"`, `export const dynamic = "force-dynamic"`. Body parses `sessionId` to `Number(key)`; `!Number.isFinite(key)` early-returns `<section className="card"><h2>Invalid session id</h2></section>`. The awaited `Promise.all` is `const [progression, frames] = await Promise.all([getSessionRaceProgression(key), getSessionReplayFrames(key)])` — both call sites inside the argument list, both destructured identifiers used as `<ReplayViewer progression={progression} frames={frames} />` inside an outer `<div className="stack">` with a `<section className="hero"><h1>Replay · Session {String(key)}</h1></section>` header preceding the viewer.
- `web/scripts/tests/replay-viewer-mvp.test.mjs` — new source-assertion test (Node `node:test`, `node:fs`, no DB/env). Implements G1–G5 exactly per Step 5: G1 iterates the 12 progression columns and asserts each is in the extracted body of `getSessionRaceProgression`, plus `FROM core.race_progression_summary` and `WHERE session_key = $1`, plus negative checks for `raw.laps` / `raw.position_history`. G2a does the symmetric check for `getSessionReplayFrames` against `core.replay_lap_frames` with the 9 columns and negative checks for `raw.weather` / `raw.race_control`. G2b asserts default-export presence and the six required substrings (`replay-driver-row`, `replay-track`, `replay-lap-marker`, `lap_number`, `position_end_of_lap`, `numDrivers`). G2c implements the brace-balanced extraction exactly as Step 5 specifies — locate marker, find self-closing `/>`, find `title={` inside that window, then walk the **full source** balancing `{`/`}` from the `title={`'s opening brace to its matching closing brace, slicing the inner expression and asserting both `lap_number` and `position_end_of_lap` substrings. G3 asserts the four frame-strip substrings. G4 asserts the import-from-`@/lib/queries/sessions` regex (both names in the same import clause), the destructure regex (captures groups 1+2), the Promise.all-arg regex (both call sites), the interpolated `<ReplayViewer progression={<g1>} frames={<g2>}` substring, and the default-import regex for `./ReplayViewer`. G5 asserts `idxHero >= 0`, `idxViewer >= 0`, `idxHero < idxViewer`.
- `diagnostic/slices/10-replay-viewer-mvp.md` — frontmatter `status=in_progress`/`status=awaiting_audit` transitions and this completion note.

**Decisions:**
- The `replay-lap-marker` element places `data-testid` as the **first** attribute and `title={...}` as the **second**, with the React `key={idx}` prop intentionally placed **after** `title={...}` rather than at the conventional first slot. Step 3 fixes this attribute order ("`data-testid="replay-lap-marker"` is the **first** attribute and `title={...}` is the **second** attribute") because Step 5 G2c's brace-balanced walker assumes `title={` is the next attribute after `data-testid` inside the `[markerIdx, closeIdx)` window. Putting `key` between them would not break G2c (it only requires `title={` somewhere in the window), but the slice text is explicit, so I followed it literally.
- The marker's `title` is a JSX template literal `` `Lap ${row.lap_number} • P${row.position_end_of_lap}` `` rather than a string-concatenation form. The brace-balanced walker in G2c naively counts every `{` and `}`, including the `${...}` openers inside the template; the walker's depth therefore goes 1 (outer `{`) → 2 (`${` for `lap_number`) → 1 (`}`) → 2 (`${` for `position_end_of_lap`) → 1 (`}`) → 0 (outer `}`), so it correctly slices the entire template-literal expression and both `lap_number` / `position_end_of_lap` substrings appear inside the slice. This is the observable test G2c demands.
- The `numDrivers` denominator (`new Set(progression.map(r => Number(r.driver_number))).size`) is computed once outside the per-driver loop and used for the marker's `top` percentage, making the vertical axis a true "positions over time" mapping rather than a constant offset, per Step 3's explicit requirement that "this is what makes this an actual 'positions-over-time' mapping rather than a constant offset". G2b enforces the literal substring `numDrivers` so the variable cannot drift to e.g. `driverCount` without the test failing.
- The frame strip's children render both an in-body literal (`L${lap_number} · ${leader} · ${flag}`) and a `title=` annotation referencing both `leader_driver_number` and `race_control_flag`, so the G3 substring assertions are satisfied via either the body or the title — matches Step 3's ("inside its body or `title` attribute") and Step 5 G3's ("substrings"). I picked the title route because it is the natural hover affordance and keeps the visible body short.
- The page uses `Promise.all([getSessionRaceProgression(key), getSessionReplayFrames(key)])` (only the two query calls) rather than mixing in the existing `getSessionByKey(key)` for header text. The header instead uses `String(key)` directly — Step 4 only requires `Replay · Session {String(key)}`, and adding a third Promise.all entry would have changed the destructure shape that G4 inspects.
- Inside the worktree, `web/node_modules` was empty, so `npm install` was run to materialize Next/TypeScript binaries before invoking `npm run typecheck` and `npm run build`. The install produced no diff: `node_modules`, `.next`, and `web/scripts/tests/.tmp-*` directories are all `.gitignore`d (verified via `git status --ignored`). No `package.json` / `package-lock.json` change is part of the slice diff.

**Gate results (exit codes):**
- Gate #1 `cd web && npm run build` — **exit `0`**. New `/replay/[sessionId]` route appears in the Next.js route summary alongside the existing routes (`├ ƒ /replay/[sessionId]                        169 B         102 kB`); compile + typecheck during build succeeded.
- Gate #2 `cd web && npm run typecheck` — **exit `0`**. `tsc --noEmit` produced no errors.
- Gate #3 `bash scripts/loop/test_grading_gate.sh` — **exit `0`**. Wrapper output: `[test_grading_gate] PASS (no new failures vs integration baseline) slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`. Direct run inside this worktree of `npm run test:grading` reports `# tests 183 # pass 134 # fail 39 # cancelled 0 # skipped 10`, where the 39 fails set is identical to the integration baseline (no new failures introduced) and the test count rose by 7 — exactly the seven sub-tests in `web/scripts/tests/replay-viewer-mvp.test.mjs` (G1, G2a, G2b, G2c, G3, G4, G5), all green.

**Self-check (acceptance criteria):**
- `cd web && npm run typecheck` exit 0 — passes (Gate #2).
- `cd web && npm run build` exit 0 — passes (Gate #1).
- `bash scripts/loop/test_grading_gate.sh` exit 0 (no new failures vs baseline) — passes (Gate #3).
- All five assertion groups (G1–G5) inside `web/scripts/tests/replay-viewer-mvp.test.mjs` pass — passes (direct `node --test scripts/tests/replay-viewer-mvp.test.mjs` reports `# tests 7 # pass 7 # fail 0`).
- `getSessionRaceProgression` SQL contains every column listed in Step 1 — passes (G1 iterates the column list and all 12 are matched).
- `getSessionReplayFrames` SQL contains every column listed in Step 2 — passes (G2a iterates the column list and all 9 are matched).
- `page.tsx` binds the awaited results into `<ReplayViewer progression={...} frames={...}>` through **shared identifiers** captured from the `Promise.all` destructure — passes (G4 destructure regex captures `progression` / `frames`, the matched Promise.all arg list contains both call sites, and the literal `<ReplayViewer progression={progression} frames={frames}` substring is present).

**Out-of-scope confirmations:**
- No client-side interactivity (no `"use client"`, no `useState`/`useEffect`/event handlers); the component is a pure server component with static inline styles.
- No charting libraries added; visualization is plain `<div>`s with inline CSS positioning.
- No telemetry-grain replay (no `core.car_data` reference); both queries are lap-grain.
- No new columns added to `core.replay_lap_frames`, `core.race_progression_summary`, or `core.race_progression_summary_mat`; the queries select an existing subset.
- No modifications to `core_build.*` source-definition layer.
- No cross-session comparison or championship-aggregate views.
- `git status` confirms only the five expected files are modified or added (slice md + the four files listed under "Changed files expected"); no other files were touched.

## Audit verdict
**Status: PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS. `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/10-replay-viewer-mvp.md`, `web/scripts/tests/replay-viewer-mvp.test.mjs`, `web/src/app/replay/[sessionId]/ReplayViewer.tsx`, `web/src/app/replay/[sessionId]/page.tsx`, and `web/src/lib/queries/sessions.ts`.
- Criterion: `getSessionRaceProgression` selects all Step 1 columns from `core.race_progression_summary` with `WHERE session_key = $1` and `ORDER BY lap_number ASC, position_end_of_lap ASC NULLS LAST` -> PASS ([web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/lib/queries/sessions.ts:359)).
- Criterion: `getSessionReplayFrames` selects all Step 2 columns from `core.replay_lap_frames` with `WHERE session_key = $1` and `ORDER BY lap_number ASC` -> PASS ([web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/lib/queries/sessions.ts:383)).
- Criterion: `ReplayViewer` renders the required empty state, computes `maxLap` and `numDrivers`, groups by `driver_number`, positions self-closing `replay-lap-marker` elements by `lap_number` and `position_end_of_lap`, binds both fields in the marker `title={...}`, and renders a frame strip referencing `leader_driver_number` and `race_control_flag` -> PASS ([web/src/app/replay/[sessionId]/ReplayViewer.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/ReplayViewer.tsx:8), [web/src/app/replay/[sessionId]/ReplayViewer.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/ReplayViewer.tsx:17), [web/src/app/replay/[sessionId]/ReplayViewer.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/ReplayViewer.tsx:84), [web/src/app/replay/[sessionId]/ReplayViewer.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/ReplayViewer.tsx:106)).
- Criterion: `page.tsx` imports both query functions from `@/lib/queries/sessions`, destructures `const [progression, frames] = await Promise.all(...)`, and renders `<ReplayViewer progression={progression} frames={frames} />` after the hero header -> PASS ([web/src/app/replay/[sessionId]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/page.tsx:1), [web/src/app/replay/[sessionId]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/page.tsx:21), [web/src/app/replay/[sessionId]/page.tsx](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/src/app/replay/[sessionId]/page.tsx:28)).
- Criterion: all five assertion groups G1-G5 pass in `web/scripts/tests/replay-viewer-mvp.test.mjs` -> PASS (`cd web && node --test scripts/tests/replay-viewer-mvp.test.mjs` exit `0`; [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:69), [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:106), [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:143), [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:202), [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:219), [web/scripts/tests/replay-viewer-mvp.test.mjs](/Users/robertzehnder/.openf1-loop-worktrees/10-replay-viewer-mvp/web/scripts/tests/replay-viewer-mvp.test.mjs:255)).
- Decision -> PASS. Slice meets scope and acceptance criteria.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware grading gate.
- [x] Make Step 3 deterministic by naming the exact automated test path this slice must add or update; do not leave test scope as “if the project has any” or fall back to a manual dev-server screenshot.
- [x] Rewrite the acceptance criteria as command-checkable outcomes, including the specific test session or fixture whose replay data must be rendered and the gate that proves it.
- [x] Expand `Changed files expected` to include the test files and any contract-facing files the stated steps necessarily modify.

### Low
- [x] Identify the concrete Phase 3 semantic contract artifact this viewer must consume instead of the generic “appropriate semantic contracts” phrasing.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-30, so no stale-state note applies.
## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T23:13:59Z, so no staleness note applies.
