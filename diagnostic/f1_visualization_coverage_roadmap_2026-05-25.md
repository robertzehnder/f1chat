# F1 visualization coverage roadmap — 2026-05-25

**Source artifacts**: 25 screenshots in [docs/f1-visualizations/](../docs/f1-visualizations/) representing the response types the chat should be able to produce.

**Goal**: ensure for each screenshot type that (a) a detector recognizes the row shape, (b) the matching component renders styling within the screenshot's tolerance, (c) a real SQL path produces the row shape end-to-end against live data.

**Architecture context** — the stack already supports every chart type in the screenshots:
- [web/src/lib/chart-types.ts](../web/src/lib/chart-types.ts) — ChartType union (17 entries)
- [web/src/components/f1-chat/charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx) — dispatcher (22 components)
- [web/src/lib/mapInsight/detectors/registry.ts](../web/src/lib/mapInsight/detectors/registry.ts) — 16 row-shape detectors
- [web/src/lib/synthesis/buildSynthesisPrompt.ts](../web/src/lib/synthesis/buildSynthesisPrompt.ts) — 6 shape templates (hero / verdict / metric-grid / composite / refusal / chart-with-metrics)

This roadmap is **verification-first**, **gap-closing-second**. It is intended as the input to `/run-loop`.

---

## 0 · Screenshot catalog (the contract)

| # | Screenshot | Response shape | Chart type | Detector | Component | Composite parts |
|---:|---|---|---|---|---|---|
| 1 | Suzuka esses comparison | chart-with-metrics | `grouped_bar` | `groupedBarDetector` | [GroupedBarChart](../web/src/components/f1-chat/charts/grouped-bar-chart.tsx) | narrative + chart + takeaways + chips |
| 2 | Monza first stint pace | chart-with-metrics | `line` | `lineDetector` | [LineChart](../web/src/components/f1-chat/charts/line-chart.tsx) | narrative + 3 tiles + chart + takeaways + chips |
| 3 | Jeddah tyre degradation | chart-with-metrics | `scatter_with_regression` | `scatterRegressionDetector` | [ScatterChart](../web/src/components/f1-chat/charts/scatter-chart.tsx) | narrative + 3 tiles + chart + takeaways + chips |
| 4 | Spa pit loss | chart-with-metrics | `horizontal_bar` | `horizontalBarDetector` | [HorizontalBarChart](../web/src/components/f1-chat/charts/horizontal-bar-chart.tsx) | narrative + 3 tiles + chart + takeaways + chips |
| 5 | Bahrain lap-1 launch | chart-with-metrics | `horizontal_bar_diverging` | `divergingBarDetector` | [DivergingBarChart](../web/src/components/f1-chat/charts/diverging-bar-chart.tsx) | narrative + 3 tiles + chart + takeaways + chips |
| 6 | Singapore overtakes | chart-with-metrics | `horizontal_bar` | `horizontalBarDetector` | HorizontalBarChart | narrative + 3 tiles + chart + takeaways + chips |
| 7 | Clean air vs traffic | chart-with-metrics | `stacked_horizontal_bar` | `stackedHorizontalDetector` | [StackedHorizontalBarChart](../web/src/components/f1-chat/charts/stacked-horizontal-bar.tsx) | narrative + 3 tiles + chart + takeaways + chips |
| 8 | Silverstone inters→slicks | chart-with-metrics | `line_dual_axis` | `lineDualAxisDetector` | [LineDualAxisChart](../web/src/components/f1-chat/charts/line-dual-axis-chart.tsx) | narrative + 3 tiles + chart (with vertical markers) + takeaways + chips |
| 9 | Monza 5-sec penalties | chart-with-metrics | `event_timeline` | `eventTimelineDetector` | [TimelineChart](../web/src/components/f1-chat/charts/timeline-chart.tsx) | narrative + 3 tiles + event rows + takeaways + chips |
| 10 | Sector 2 minisectors v1 | chart-with-metrics | `grouped_bar` | `groupedBarDetector` | GroupedBarChart | (same as #1) |
| 11 | Monza speed trap | chart-with-metrics | `horizontal_bar` | `horizontalBarDetector` | HorizontalBarChart | (same as #4) |
| 12 | VER vs NOR 7-axis radar | chart-with-metrics | `radar` | `radarDetector` | [RadarChart](../web/src/components/f1-chat/charts/radar-chart.tsx) | narrative + chart + takeaways + chips |
| 13 | Saudi brake-zone speed drop | chart-with-metrics | `line` (single series) | `lineDetector` | LineChart | narrative + 3 tiles + chart + takeaways + chips |
| 14 | Telemetry-weather coverage | chart-with-metrics | `status_grid` | `statusGridDetector` | [StatusGridChart](../web/src/components/f1-chat/charts/status-grid.tsx) | narrative + 3 tiles + table + takeaways + chips |
| 15 | Suzuka pole lap time | **hero** | `metric_grid` (hero variant) | n/a (synthesis-emitted) | [HeroScalar](../web/src/components/f1-chat/charts/hero-scalar.tsx) | huge time + caption + narrative + takeaways + chips |
| 16 | Canada over-cut verdict | **verdict** | n/a | n/a (synthesis-emitted) | [VerdictCard](../web/src/components/f1-chat/charts/verdict-card.tsx) | huge YES + caption + 3 tiles + takeaways + chips |
| 17 | Bahrain heaviest brake zones | chart-with-metrics | `horizontal_bar` (delta variant) | `horizontalBarDetector` | HorizontalBarChart | narrative + chart (right-aligned values) + footer avg + takeaways + chips |
| 18 | Spa Mercedes strategy split | chart-with-metrics | `stint_gantt` | `stintGanttDetector` | [StintGantt](../web/src/components/f1-chat/charts/stint-gantt.tsx) | narrative + 3 tiles + gantt + compound legend + takeaways + chips |
| 19 | Bahrain stint-by-stint deltas | chart-with-metrics | `line_with_stint_markers` | `lineWithStintMarkersDetector` | [LineWithStintMarkers](../web/src/components/f1-chat/charts/line-with-stint-markers.tsx) | narrative + chart + vertical pit markers + takeaways + chips |
| 20 | Sector 2 minisectors v2 | chart-with-metrics | `track_heatmap` (strip view) | `trackHeatmapDetector` | [MinisectorStrip](../web/src/components/f1-chat/charts/minisector-strip.tsx) | narrative + 3 tiles + bullet-list bars + takeaways + chips |
| 21 | Singapore DRS zone share | chart-with-metrics | `donut` | `donutDetector` | [DonutChart](../web/src/components/f1-chat/charts/donut-chart.tsx) | narrative + 3 tiles + donut + takeaways + chips |
| 22 | Imola front-right graining | **composite** (verdict + line + tiles) | composite | (synthesis-driven) | [CompositeCard](../web/src/components/f1-chat/charts/composite-card.tsx) | verdict + narrative + chart + 3 tiles + takeaways + chips |
| 23 | (truncated header — partial Verstappen first stop) | chart-with-metrics | `pit_event_strip` | `pitEventStripDetector` | [PitEventStrip](../web/src/components/f1-chat/charts/pit-event-strip.tsx) | (same as #24) |
| 24 | Canada Verstappen first stop | chart-with-metrics | `pit_event_strip` | `pitEventStripDetector` | PitEventStrip | narrative + 3 tiles + pit strip + P1→P3→P1 progression + takeaways + chips |

**No screenshot maps to a missing component or missing detector.** Every type in the catalog has a complete code path. The work below is therefore verification + polish + data-path completion, not new chart construction.

---

## 1 · Slice plan

Each slice below targets one *category of work*, not one screenshot. The first three slices verify what exists; the next four close any gaps surfaced by the first three; the last two polish the composite-card UI to match the screenshots.

### Phase 1 — Verification (no code changes; produces a gap report)

#### Slice 1: `viz-01-detector-fixture-audit`

**Goal**: ensure every detector in the registry has at least one fixture in [web/scripts/health/](../web/scripts/health/) that exercises both `matches()` and `build()` against a representative row set; and that the produced ChartSpec round-trips through the matching component without runtime errors.

**Steps**:
1. Read [web/src/lib/mapInsight/detectors/registry.ts](../web/src/lib/mapInsight/detectors/registry.ts); enumerate the 16 detectors + their `fixtures: ["mXX"]` field.
2. For each fixture m01–m22, locate or generate a JSON sample row file under `web/scripts/health/fixtures/<fixture>.json`.
3. Add a smoke test under `web/scripts/tests/detector-coverage.test.ts` that imports each fixture, runs `runDetectorRegistry()`, asserts the returned `detectorId` matches the declared fixture-detector mapping, and asserts the ChartSpec passes a Zod schema (`ChartSpec`) without throwing.
4. Emit a report file `diagnostic/artifacts/viz-coverage-report-<date>.md` enumerating any detector whose fixture is missing or whose Spec fails validation.

**Acceptance**:
- `cd web && npm run test:adapter` passes the new detector-coverage suite.
- The coverage report contains zero unresolved gaps (detectors without fixtures, fixtures without detectors).

**Changed files expected**:
- `web/scripts/health/fixtures/m*.json` (one per detector if absent)
- `web/scripts/tests/detector-coverage.test.ts`
- `diagnostic/artifacts/viz-coverage-report-2026-05-25.md`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

---

#### Slice 2: `viz-02-component-screenshot-parity`

**Goal**: render each screenshot's ChartSpec in isolation via a storybook-style harness; visually diff against the screenshot; record divergences.

**Steps**:
1. Create `web/scripts/health/screenshot-parity.tsx` — a small Next.js page (under `/_dev/screenshot-parity` route, gated by `process.env.NODE_ENV !== 'production'`) that iterates over each of the 25 screenshot ChartSpecs and renders them stacked vertically with the screenshot filename above each.
2. For each screenshot in [docs/f1-visualizations/](../docs/f1-visualizations/), construct the equivalent `ChartSpec` literal (either by manual transcription or by running its fixture through the detector). Place these literals in `web/scripts/health/screenshot-specs.ts`.
3. Start the dev server, open the page, capture each rendered card; place into `diagnostic/artifacts/screenshot-parity-2026-05-25/<n>.png`.
4. Write a comparison report `diagnostic/artifacts/screenshot-parity-2026-05-25.md` listing for each of the 25 cards: matches / minor styling drift / major divergence / data-shape mismatch.

**Acceptance**:
- All 25 rendered cards present on `/_dev/screenshot-parity` without console errors.
- Report classifies each card with one of the four categories above + a one-line description.

**Changed files expected**:
- `web/src/app/_dev/screenshot-parity/page.tsx`
- `web/scripts/health/screenshot-specs.ts`
- `diagnostic/artifacts/screenshot-parity-2026-05-25.md`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run build:dev   # or `next build` if no dev build script
```

---

#### Slice 3: `viz-03-sql-coverage-audit`

**Goal**: confirm each screenshot's data shape can be produced by a real SQL path against the analytics matviews. For screenshots where the SQL doesn't yet exist, identify which matview is missing or which join is required.

**Steps**:
1. For each of the 25 screenshots, identify the source matview(s) likely required (e.g. Suzuka esses → `analytics.corner_speed_by_driver`; Pit loss → `analytics.pit_stops_by_driver`).
2. Run a representative SQL query against the live DB for each; record the row shape produced.
3. Compare the produced shape to the detector's `matches()` requirements. Flag mismatches in `diagnostic/artifacts/sql-coverage-2026-05-25.md`.
4. For each gap, propose either (a) a new matview migration, (b) a query template addition in `web/src/lib/llm-sql/templates/`, or (c) a detector tolerance extension.

**Acceptance**:
- Report enumerates 25 screenshot types × {matview present / matview missing / column shape mismatch / detector won't match}.
- At most 5 GAPs flagged; each has a one-line proposed remediation.

**Changed files expected**:
- `diagnostic/artifacts/sql-coverage-2026-05-25.md`
- `web/scripts/health/sql-coverage.ts` (helper that ran the queries)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npx tsx scripts/health/sql-coverage.ts > /dev/null
```

---

### Phase 2 — Gap closure (one slice per gap class surfaced by Phase 1)

The next slices are **placeholders** — their exact scope is determined by Phase 1's reports. Do not generate slice files for these until Phase 1 reports exist. Slice IDs reserved in the index so the loop can pick them up later.

#### Slice 4: `viz-04-detector-tolerance-fixes`
Fix any detector whose `matches()` returns false against a real-world row shape (typically: a column the SQL emits with a different name than the detector expected). Each fix updates the detector's regex set + adds a regression fixture.

#### Slice 5: `viz-05-component-styling-drift`
Fix any component whose rendered card differs from the screenshot in non-trivial ways: misaligned axes, wrong color palette, missing legend, off-by-one tile layout. Each fix lands a CSS / Recharts prop change + a Playwright screenshot diff anchor.

#### Slice 6: `viz-06-missing-matview-or-template`
Add SQL paths for any screenshot whose data shape is not currently producible. Each path is either a new matview migration (`sql/migrations/deploy/NNN_...sql`) or a new LLM-SQL template (`web/src/lib/llm-sql/templates/<name>.ts`).

#### Slice 7: `viz-07-composite-shape-template`
For Imola front-right graining (screenshot #22), confirm the synthesis prompt's `compositeTemplate()` actually emits the right combination (verdict + line + tiles) and that [CompositeCard](../web/src/components/f1-chat/charts/composite-card.tsx) renders the combined block correctly.

---

### Phase 3 — Card-shell polish (1 slice)

#### Slice 8: `viz-08-card-shell-parity`

**Goal**: the outer card shell — red dot + title + race subtitle + narrative + chart + KEY TAKEAWAYS + EXPLORE FURTHER chips — should match the screenshots exactly. Whitespace, line-rule color, takeaway-bullet dash style, chip pill shape all flow from one shared layout component.

**Steps**:
1. Locate the current outer-card component (likely `web/src/components/f1-chat/insight-card.tsx` or similar). Read it.
2. Side-by-side with screenshot #1, identify every styling delta: header dot diameter, font weights, gap between sections, divider line color/opacity, KEY TAKEAWAYS label size + letter-spacing, dash-prefix color on takeaways, chip pill background + border + text color.
3. Update the shared shell to match. Single Tailwind file; no per-card overrides.
4. Re-run `viz-02-component-screenshot-parity`; the report should classify all 25 cards as "matches" or "minor styling drift" only — no "major divergence" entries.

**Acceptance**:
- All 25 cards on `/_dev/screenshot-parity` are visually within 5% of their screenshots (subjective; capture before/after PNG for sign-off).
- No regressions in `npm run test:adapter`.

**Changed files expected**:
- `web/src/components/f1-chat/insight-card.tsx` (or actual outer-card component)
- `web/src/app/globals.css` (if shell-level CSS variables need adjustment)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run lint
cd web && npm run test:adapter
```

---

## 2 · Slice queue order

Append to `diagnostic/slices/_index.md` under a new "Phase 22 — visualization coverage" heading, in this order:

1. `viz-01-detector-fixture-audit`
2. `viz-02-component-screenshot-parity`
3. `viz-03-sql-coverage-audit`
4. *(Phase 1 reports drive)* `viz-04-detector-tolerance-fixes`, `viz-05-component-styling-drift`, `viz-06-missing-matview-or-template`, `viz-07-composite-shape-template`
5. `viz-08-card-shell-parity`

Phase 1 is the gate. Phase 2's actual scope (and whether all four placeholders ship vs. only some) is determined by Phase 1's reports. Phase 3 runs last to make the screenshots visually exact.

---

## 3 · Non-goals

- **New chart types.** Every screenshot maps to an existing component. If a future use case needs a chart shape not in the 17-type union, it's a separate scope.
- **Synthesis prompt overhaul.** The 6-shape template surface is sufficient. Polishing wording per shape is in scope under `viz-04`/`viz-07` only when a screenshot's narrative line is clearly off-target.
- **Backwards-compat for legacy chart specs.** If a screenshot demands a chart shape that the existing detector can't emit, prefer to extend the detector over creating a parallel shape.

---

## 4 · Definition of done

When the loop has merged all 8 slices:
- Every screenshot in [docs/f1-visualizations/](../docs/f1-visualizations/) renders within 5% visual delta at the same dev-page URL.
- `npm run test:adapter` includes coverage assertions tied to each screenshot's detector + fixture.
- A real chat question for each of the 25 categories returns the equivalent card on the live UI (manual smoke test of 5 representative questions; not gated by an automated test).
- The coverage and parity reports are checked in under `diagnostic/artifacts/` as the audit trail.

---

## 5 · How to invoke

```
/run-loop diagnostic/f1_visualization_coverage_roadmap_2026-05-25.md
```

The loop will read this file, propose the 8-slice decomposition, wait for your confirmation, then write the slice files, start the runner, and report progress. Phase 1 finishes before Phase 2 slices are auto-generated — confirm Phase 1's reports look right before letting Phase 2 proceed.
