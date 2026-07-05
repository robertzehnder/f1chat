# F1 Visualizations Data + Styling Roadmap

**Status**: draft roadmap  
**Date**: 2026-05-25  
**Screenshot corpus**: `docs/f1-visualizations/*.png` (25 files)  
**Primary goal**: ensure every representative F1 Insights response screenshot can be produced from real data, typed chart contracts, stable renderers, and repeatable visual QA.

---

## 1. Why This Roadmap Exists

The screenshots in `docs/f1-visualizations/` are the product-facing source of truth: they show the response cards we expect users to see for the major answer shapes. The code already has a substantial implementation:

- `web/src/__mocks__/insights/manifest.ts` declares 21 implemented fixtures plus 2 follow-up shapes.
- `web/src/components/f1-chat/charts/` contains renderers for the core chart family.
- `web/src/lib/mapInsight.ts` folds SSE response parts into `DraftInsight`.
- `web/src/lib/mapInsight/detectors/registry.ts` maps result row shapes to chart specs.
- `web/scripts/tests/visualization-contract.test.ts` validates `diagnostic/v0_visualization_expectations.json`.
- `web/src/app/mock/page.tsx` renders the fixture review surface.

The remaining work is not just "make charts exist." The real problem is end-to-end determinism:

1. each screenshot maps to a named visual pattern;
2. each visual pattern has a typed data contract;
3. the backend can produce the required fields;
4. the adapter/detector selects the correct visual;
5. the renderer matches the screenshot styling;
6. CI catches regressions before a live chat response drifts.

---

## 2. Current State Snapshot

### Screenshot Corpus

`docs/f1-visualizations/` currently contains 25 PNG screenshots. Most are normal card-sized screenshots; one file is suspiciously tiny (`15x4`) and should be treated as a likely accidental crop until reviewed.

### Implemented Fixture Inventory

The fixture manifest currently ships 21 in-scope visuals:

| ID | Visual | Current status |
|---|---|---|
| M01 | Hero scalar | implemented |
| M02 | Yes / No verdict | implemented |
| M03 | Metric grid | implemented |
| M04 | Corner grouped bar | implemented |
| M05 | Braking / traction grouped bar | implemented |
| M06 | Horizontal ranking bar | implemented |
| M08 | Stint Gantt | implemented |
| M09 | Multi-line chart | implemented |
| M10 | Line with stint markers | implemented |
| M11 | Scatter + regression | implemented |
| M12 | Diverging bar | implemented |
| M13 | Stacked horizontal bar | implemented |
| M14 | Dual-axis line | implemented |
| M15 | Event timeline | implemented |
| M16 | Minisector heatmap / strip | implemented |
| M17 | Radar | implemented |
| M18 | Status grid | implemented |
| M19 | Donut | implemented |
| M20 | Composite card | implemented |
| M21 | No-data refusal | implemented |
| M22 | Pit event strip | implemented |

Two known visual shapes remain explicit follow-ups:

| ID | Visual | Gap |
|---|---|---|
| M07 | Team-grouped horizontal bar with team-color side strip | renderer + chart type + detector |
| M23 | Track marker map for overtake location | renderer + chart type + circuit geometry + detector |

### Key Architectural Gaps

- `ChartSpec` is still a broad optional interface rather than a discriminated union, which allows impossible chart payloads to typecheck.
- `ChartRenderer` still casts several chart props through `as any`.
- The detector registry covers many chart specs, but not every rendered fixture shape or top-level visual slot.
- The screenshot corpus is not yet machine-readable: there is no manifest tying each PNG to fixture ID, qid, prompt, expected visual, data fields, and acceptance threshold.
- Visual QA is currently fixture-contract oriented; it does not yet compare screenshots against approved baselines.

---

## 3. Target Architecture

The target system has four stable contracts.

### Contract A — Screenshot Manifest

Create `docs/f1-visualizations/manifest.json`:

```json
{
  "screenshots": [
    {
      "file": "Screenshot 2026-05-25 at 3.38.11 PM.png",
      "fixture_id": "m04",
      "visual_id": "grouped_bar",
      "prompt": "Compare Verstappen and Hamilton through the Suzuka esses...",
      "sample_qid": 1717,
      "status": "implemented",
      "notes": "Expected grouped bar, absolute entry speed, VER/HAM colors"
    }
  ]
}
```

Rules:

- Every PNG must map to exactly one `fixture_id` or be marked `discard`.
- Every `implemented` screenshot must map to a renderer that exists in `ChartRenderer` or an `InsightCard` top-level slot.
- Screenshots that represent variants of the same visual should share `fixture_id` but carry a `variant` field.
- The tiny `15x4` screenshot must be classified as `discard` or replaced.

### Contract B — Typed Visual Data

Replace the broad `ChartSpec` optional field bag with a discriminated union:

```ts
type ChartSpec =
  | GroupedBarSpec
  | HorizontalBarSpec
  | StintGanttSpec
  | LineSpec
  | RadarSpec
  | StatusGridSpec
  | DonutSpec
  | PitEventStripSpec
  | TrackMarkerMapSpec;
```

Rules:

- Renderer props accept only their matching discriminated spec.
- No `as any` in `ChartRenderer`.
- Top-level card visuals (`hero`, `verdict`, `metrics`, `composite`, `refusal`) get explicit `InsightCardProps` slots, not fake chart types.

### Contract C — Live Adapter Selection

Each benchmark qid maps to an expected visual in `diagnostic/v0_visualization_expectations.json`. Live responses must satisfy:

- result rows contain fields required by the expected visual;
- structured synthesis fills title/body/metrics/takeaways where row data cannot;
- `runDetectorRegistry()` picks the expected chart when a chart is appropriate;
- semantic passes (`applyScalarHero`, `applyVerdictSemantics`, `applyResponseSemantics`) handle top-level non-chart visuals.

### Contract D — Visual Regression

Add a visual QA path that renders:

- fixture `/mock` cards;
- selected live captured `ChatApiResponse` fixtures;
- screenshot-corpus reference cards.

The visual gate should compare against approved baselines with tolerances for anti-aliasing, but should fail on layout shifts, missing charts, wrong chart type, wrong colors, missing legends, or unusable mobile layout.

---

## 4. Roadmap

### Phase 1 — Screenshot Source Of Truth

**Goal**: make `docs/f1-visualizations/` auditable.

**File changes**:

- Add `docs/f1-visualizations/manifest.json`.
- Add `diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md`.
- Optionally rename screenshots to stable names:
  - `m04-suzuka-esses-grouped-bar.png`
  - `m17-driver-performance-radar.png`
  - `m21-no-data-refusal.png`

**Tasks**:

- Classify all 25 PNGs.
- Mark accidental / duplicate screenshots explicitly.
- Map each usable screenshot to `m01`-`m23`, prompt, qid, expected renderer, and current implementation status.
- Cross-check screenshot count against `IMPLEMENTED_FIXTURES` and `FOLLOW_UP_FIXTURES`.

**Acceptance**:

- 100% of screenshots are classified.
- No anonymous screenshots remain.
- Every implemented screenshot has a matching fixture or a planned fixture.
- Tiny `15x4` image is either replaced or excluded with a reason.

---

### Phase 2 — Coverage Matrix

**Goal**: one table showing screenshot → fixture → renderer → detector → data source.

**File changes**:

- Add `diagnostic/f1_visualization_coverage_matrix_2026-05-25.md`.
- Add generated JSON if useful: `diagnostic/f1_visualization_coverage_matrix.json`.

**Matrix columns**:

- `visual_id`
- `screenshot_file`
- `fixture_id`
- `chart_type`
- `renderer`
- `top_level_slot` (`hero`, `verdict`, `metrics`, `refusal`, etc.)
- `detector_id`
- `required_row_fields`
- `synthesis_fields`
- `backend_sources`
- `status`
- `blocking_gap`

**Acceptance**:

- Matrix covers all screenshot-manifest entries.
- Matrix includes all 21 implemented fixture manifest entries.
- Matrix explicitly tracks M07 and M23 as follow-up or in-scope, not ambiguous.

---

### Phase 3 — Renderer Completeness

**Goal**: all screenshot-visible visuals have first-class renderers.

**Work items**:

- Implement `TeamGroupedHorizontalBarChart` for M07 if any screenshot requires it.
- Implement `TrackMarkerMap` for M23 if any screenshot requires it.
- Add `horizontal_bar_team_grouped` and `track_marker_map` to `ChartType` only when renderers exist.
- Remove `as any` casts in `ChartRenderer`.
- Split chart props into shape-specific interfaces.
- Ensure top-level slots render consistently:
  - hero scalar;
  - verdict;
  - metric grid;
  - no-data refusal;
  - composite cards.

**Styling requirements**:

- Use one canonical token source for F1 team colors.
- Enforce dark card surface, border, spacing, typography, legend layout, and tooltip style from the screenshots.
- Every chart must have mobile behavior:
  - labels do not overlap;
  - legends wrap or collapse cleanly;
  - tables/status grids scroll intentionally;
  - touch targets remain usable.

**Acceptance**:

- `/mock` renders every implemented fixture without fallback "not implemented" UI.
- No renderer receives `chart as any`.
- M07/M23 are either fully implemented or explicitly hidden from screenshot manifest status.

---

### Phase 4 — Data Contracts Per Visual

**Goal**: every visual has a documented data shape that the backend can actually produce.

**File changes**:

- Add `web/src/lib/visualizationContracts.ts`.
- Add or extend tests in `web/scripts/tests/visualization-contract.test.ts`.

**Contract examples**:

- `grouped_bar`: `corner_label`, `driver_name`, absolute speed/metric columns, team color mapping.
- `horizontal_bar`: label column, numeric value column, optional team column.
- `stint_gantt`: driver, stint start/end lap, compound, total laps.
- `line`: lap/stint index, driver or series label, numeric value, unit format.
- `radar`: driver rows plus seven axis columns, max value, data-quality flags.
- `status_grid`: row label plus source-status cells.
- `pit_event_strip`: phase labels, durations, position before/after.
- `track_marker_map`: circuit identifier, marker x/y positions, corner labels, team color.

**Data-source mapping**:

For each visual, document the database/view source:

- sessions / drivers / laps;
- car data / location;
- weather;
- pit stops;
- race control;
- derived analytics views such as degradation, traffic pace, restart performance, overtakes, driver performance score.

**Acceptance**:

- Every screenshot-mapped visual has `required_fields`.
- Every `required_field` is supplied by either SQL rows, structured synthesis, or deterministic adapter logic.
- No visual relies on "whatever columns happen to be returned."

---

### Phase 5 — Detector Registry Completion

**Goal**: live rows choose the same visual as the screenshot/fixture expectation.

**Work items**:

- Audit current detectors in `web/src/lib/mapInsight/detectors/registry.ts`.
- Add missing detectors for:
  - `pit_event_strip`;
  - `horizontal_bar_team_grouped` if M07 is in scope;
  - `track_marker_map` if M23 is in scope;
  - composite card triggers where row-only detection is insufficient.
- Strengthen existing detectors:
  - reject delta columns when absolute values are required;
  - distinguish ranking bars from diverging bars;
  - distinguish lap-time lines from scalar summaries;
  - distinguish status-grid data-health rows from ordinary tables.

**Acceptance**:

- Every `expected_visual` in `diagnostic/v0_visualization_expectations.json` either has a detector, a top-level semantic pass, or an explicit allowed fallback.
- `npm run test:visualization-contract` passes.
- Adapter tests include at least one captured response per implemented visual.

---

### Phase 6 — Structured Synthesis Slots

**Goal**: styling slots are filled reliably even when rows only carry chart data.

**Work items**:

- Ensure synthesis payload can fill:
  - title;
  - subtitle;
  - body;
  - metrics;
  - key takeaways;
  - related questions;
  - hero;
  - verdict;
  - refusal `what_we_have`.
- Add schema validation for structured fields.
- Add parse-rate telemetry and fallback behavior.
- Keep chart data deterministic; do not ask the model to invent chart values.

**Acceptance**:

- For every screenshot visual, the non-chart card slots can be produced from either deterministic logic or structured synthesis.
- No screenshot-mapped card renders as chart-only body text unless explicitly marked as a fallback.

---

### Phase 7 — Screenshot-Based Visual QA

**Goal**: screenshots become regression tests.

**File changes**:

- Add Playwright route coverage for `/mock`.
- Add visual baseline snapshots under a stable directory, for example:
  - `web/tests/visual-baselines/mock/m04.png`
  - `web/tests/visual-baselines/live/q1717.png`
- Add `npm run test:visual` and include it in `verify:ui` once stable.

**Test levels**:

1. **Fixture visual test**: render every implemented fixture on `/mock`.
2. **Screenshot manifest test**: verify every screenshot has an implemented or follow-up status.
3. **Live fixture test**: replay captured `ChatApiResponse` fixtures through `mapInsight.ts` and render cards.
4. **Responsive sweep**: desktop, tablet, mobile widths.

**Acceptance**:

- No missing chart warnings on `/mock`.
- Visual diffs stay under threshold.
- Mobile screenshots are separately approved for dense charts.

---

### Phase 8 — Live Benchmark Capture

**Goal**: prove real prompts produce the expected visuals, not just fixtures.

**Work items**:

- Run the benchmark qids from `diagnostic/v0_visualization_expectations.json`.
- Capture final `ChatApiResponse`, rows, SQL, synthesis insight fields, and resulting `DraftInsight`.
- Store sanitized fixtures under `web/scripts/fixtures/visualization-responses/`.
- Add adapter tests that assert:
  - visual type;
  - required fields;
  - no forbidden fallback;
  - data quality notes when applicable.

**Acceptance**:

- At least one live captured response for each implemented visual.
- All non-fallback expectations pass.
- Allowed fallbacks are documented with reason and owner.

---

## 5. Priority Order

### Tier 0 — Inventory And Guard Rails

1. Screenshot manifest.
2. Coverage matrix.
3. Update `visualization-contract.test.ts` to read screenshot manifest.

### Tier 1 — Close Visible Gaps

1. Implement or explicitly defer M07 and M23 based on screenshot manifest.
2. Remove `as any` casts in chart renderer.
3. Add shape-specific chart contracts.
4. Ensure `/mock` renders all screenshot-required visuals.

### Tier 2 — Live Data Confidence

1. Complete missing detectors.
2. Add captured live response fixtures.
3. Add per-qid visual assertions.
4. Add data-quality SQL checks for analytics views that feed radar/status/traffic/restart visuals.

### Tier 3 — Exact Styling Confidence

1. Playwright screenshot baselines.
2. Mobile visual baselines.
3. Tooltip/legend/axis interaction tests.
4. CI `verify:ui` includes stable visual gates.

---

## 6. Architectural Decisions To Settle

1. **Is M07 in scope now?**  
   If any screenshot shows team-grouped side strips, M07 must move from follow-up to implemented.

2. **Is M23 in scope now?**  
   If any screenshot shows overtake markers on a circuit map, M23 needs geometry assets and a renderer.

3. **Fixture-first or live-first?**  
   Recommended: fixture-first for styling, live-capture second for data correctness.

4. **Discriminated union timing**  
   Recommended: do it before adding more chart shapes. The current flat `ChartSpec` makes regressions too easy.

5. **Visual diff tolerance**  
   Recommended: start permissive for anti-aliasing, strict for element presence and layout bounds.

6. **Circuit geometry source**  
   For M16/M23, decide whether track shapes are hand-authored SVGs, normalized coordinate maps, or generated from telemetry location data.

---

## 7. Done Definition

This roadmap is complete when:

- every screenshot in `docs/f1-visualizations/` is classified;
- every non-discard screenshot maps to an implemented visual or a named follow-up;
- `/mock` renders all implemented visuals;
- every implemented visual has a typed data contract;
- every required data field has a backend or synthesis source;
- live captured responses cover every implemented visual;
- visual regression tests protect the screenshot set;
- `npm run verify:ui` passes;
- M07/M23 are either implemented or explicitly absent from the screenshot corpus.

---

## 8. Suggested First Commit

**Commit title**: `docs: map F1 visualization screenshots to visual contracts`

**Scope**:

- Add `docs/f1-visualizations/manifest.json`.
- Add `diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md`.
- Add a small script to validate:
  - referenced screenshot files exist;
  - fixture IDs exist in `INSIGHT_FIXTURES`;
  - implemented entries map to real renderers;
  - discard entries have a reason.

This first commit is intentionally documentation + validation only. It creates the stable source of truth before code changes begin.
