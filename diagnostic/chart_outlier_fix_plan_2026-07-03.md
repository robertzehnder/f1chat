# Chart-outlier fix plan (live-UI visual audit, 2026-07-03)

Reviewed by GPT-5.5 (/2ndopinion, verdict REVISE → integrated). Grounded in the real data flow:
prompt → /api/chat → detector registry → `ChartSpec`/`ChartSeries` → renderer. The central
correction from review: the enabling gap is the **series contract**, not the color helper.

## Phase A — Enabling: extend the `ChartSeries` contract  (prerequisite)
`src/lib/chart-types.ts:33` — `ChartSeries` carries only `{name, values, color}`; renderers have
no way to receive a line style, so any helper change can't reach the chart. Add optional, back-compat
fields: `strokeDasharray?`, `strokeWidth?`, `opacity?`, and (for Fix 2) `emphasis?: boolean`.
Consume them in the three line renderers (`line-chart.tsx:74`, `line-dual-axis-chart.tsx:184`,
`telemetry-overlay-chart.tsx:103`). All optional → zero impact on existing specs.

## Fix 1 (P1, real bug) — Teammate color collision
Root cause (corrected): `getDistinctTeamColors` (`f1-team-colors.ts:107`) lightens the 2nd teammate
35% on one channel — too weak on overlapping lines. The dual-axis path ALREADY uses the helper
(`registry.ts:889`), so re-routing isn't the fix. **Missed path:** radar uses raw `getTeamColor`
(`registry.ts:651`), so teammate radars still collide.
- Add sibling `getDistinctTeamStyles(names): Record<name,{color, strokeDasharray}>` — keep
  `getDistinctTeamColors` (color-only) unchanged for the many bar/map consumers.
- 1st teammate = solid team color; 2nd = stronger-lightened + dashed; 3rd = dash-dot. Dash is a
  non-color channel → also helps color-blind users.
- Apply in the same-team line/comparison detectors: telemetry, line_dual_axis, line, race_trace,
  position, scatter, and **radar (switch `getTeamColor`→distinct at registry.ts:651)**.
- **Telemetry pedal-panel conflict (review #4):** brake is already dashed vs throttle solid
  (`telemetry-overlay-chart.tsx:199`). Reserve dash for teammate identity on the speed+gear panels;
  in the pedal panel differentiate teammates by opacity/width (not dash) so B's throttle ≠ A's brake.
- Verify live on #5 (Ferrari telemetry) + #12 (Sauber wet crossover) + a teammate radar. Unit-test
  `getDistinctTeamStyles` returns distinct color AND dash for a same-team pair.

## Fix 5 (P2, honesty/quality) — No-data cards under-explain  (conservative)
Seam (corrected): NOT `countList.ts` (it gets only empty rows, no context). Do it in the zero-row
branch at `orchestration.ts:1541`, which has `selectedTemplateKey`, resolved session + drivers, and
`cachedRunSql`.
- For a single-driver template returning 0 rows, probe lap-count + `raw.pit` count for the resolved
  (session, driver). Emit **factual, non-fabricated** context only: "Tsunoda has 2 lap records and
  no pit stop recorded for this race" — NOT "retired before pitting" ("retired" needs classification
  evidence; review #6). Handle "asked for 2nd stop, only 1 exists" as a distinct case.
- Guard: must not reintroduce fabricated absence — the message states what the data shows, nothing
  inferred about cause.

## Fix 5b (P3) — Clarification card: human session labels
`chatRuntime.ts:2132` builds the raw-key prompt; candidates already carry `sessionName`/`label`
(`chatRuntime.ts:1786`). Emit `Qualifying, session_key 9989` / `Sprint Qualifying, session_key 9994`
(label + key, so it's both readable and still disambiguable).

## Fix 3 (P2, design+data) — Radar degenerate spike
Decision lives in the DETECTOR, not the renderer (review #8). `registry.ts:667` already computes
dropped/zero axes and keeps the full set when <3 would remain (the degenerate shape). When live axes
< 3, return a different `ChartSpec` (horizontal delta/bar of the populated axes) instead of a 2-axis
radar. Separately log the data-completeness backlog item: `analytics.driver_performance_score`
(migration 045) is mostly unpopulated for 2025.

## Fix 4 (P3, design) — Track-dominance monochrome + legend
- Detector drops both drivers from the spec (`registry.ts:1465`) and the legend counts only leaders
  present in segments (`minisector-strip.tsx:63`) → 0-sector driver disappears. Add both drivers +
  sector counts to the spec/legend ("Hamilton 0 · Norris 3").
- Add explicit sector-boundary strokes/ticks in `track-map.tsx:199` (today same-color adjacent
  sectors read as continuous except a center stripe).

## Fix 2 (P3, design) — Position-change spaghetti
Needs a real contract (review #9): the detector builds series from rows independently
(`registry.ts:1175`). Compute emphasized drivers IN the detector from grid→final deltas (biggest
climber/faller + winner), set `series.emphasis` (Phase A field); render emphasized full color/width,
the rest dimmed thin low-opacity. Keeps full field + legend.

## Fix 6 (P4, nit) — Pluralization
"1 laps" → "1 lap" in the wet-crossover insight via a pluralize helper.

## Sequence & verification
A (contract) → 1 (styles across line+radar) → 5 + 5b (honesty) → 3 (radar spec) + 4 (dominance) →
2 (position emphasis) → 6. Verify each live via the audit prompts (#5,#12,#13,#9,#14,#4) + unit tests
(styles helper, no-data probe, radar-spec-switch, pluralize) + `npm run typecheck` + the Playwright
pixel gate (add same-team + all-sector-sweep + DNF fixtures so these can't regress silently).

## Risk / scope notes
- Contract fields optional → back-compat. Dash channel aids color-blind users.
- Honesty guard on Fix 5 is load-bearing: state observed data only, never infer cause.
- Radar data gap (2025 7-axis model) is a separate warehouse-completeness backlog item, not a visual fix.
