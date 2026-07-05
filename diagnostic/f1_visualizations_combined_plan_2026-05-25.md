# F1 visualizations — combined data + styling plan (2026-05-25)

**Status**: combined plan, supersedes:
- [f1_visualizations_data_styling_roadmap_2026-05-25.md](./f1_visualizations_data_styling_roadmap_2026-05-25.md) (Codex's plan — kept as architecture reference)
- [f1_visualization_coverage_roadmap_2026-05-25.md](./f1_visualization_coverage_roadmap_2026-05-25.md) (my plan — kept as slice-format reference)

**Source artifacts**: 25 PNG screenshots in [docs/f1-visualizations/](../docs/f1-visualizations/), captured 2026-05-25.

**Goal**: ensure every representative F1 Insights response screenshot can be produced from real data, typed chart contracts, stable renderers, and repeatable visual QA — verified end-to-end against the live backend.

**Invocation target**: this document is the input to `/run-loop`. Each phase below has slice-formatted deliverables ready for the loop to pick up.

---

## 0 · Decisions resolved upfront

Codex's plan surfaced 6 architectural decisions. Reviewing all 25 screenshots against the fixture manifest at [web/src/__mocks__/insights/manifest.ts](../web/src/__mocks__/insights/manifest.ts):

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | M07 (team-grouped horizontal bar w/ side strip) in scope? | **Deferred** | None of the 25 screenshots show team-grouped bars with team-color side strips. Per-driver-colored horizontal bars (#4, #6, #11) use individual colors, not team grouping. Re-evaluate when a future screenshot demands it. |
| 2 | M23 (track marker map for overtakes) in scope? | **Deferred** | None of the 25 screenshots show a track-shape view with overtake markers. Screenshot #20 (Sector 2 minisectors v2) uses `track_heatmap` *strip* view (M16, already implemented), not a map. Re-evaluate with circuit-geometry data source decision. |
| 3 | Fixture-first or live-first? | **Fixture-first for styling; live-second for data correctness** | Codex's recommendation. Styling parity needs a deterministic fixture; data correctness needs real SQL output. Order: get fixture rendering pixel-clean, then capture live responses and assert against the same visual contract. |
| 4 | Discriminated-union refactor timing? | **Before any new chart shapes; after current verification phase** | The flat `ChartSpec` + 5× `as any` in `ChartRenderer` (verified: `grep -c 'as any' web/src/components/f1-chat/charts/index.tsx` = 5) is architecture debt. Refactor in Phase 3, after Phase 1's manifest establishes the inventory but before any renderer changes. |
| 5 | Visual diff tolerance? | **Permissive for anti-aliasing (≤2% pixel delta); strict for element presence and layout bounds** | Standard Playwright pattern. AA / font-rendering will always drift between machines; layout shifts won't. |
| 6 | Circuit geometry source (M16/M23)? | **Deferred with M23**; M16's strip view doesn't need geometry. | Only re-opens if M23 moves in-scope. |

---

## 1 · Premise + current state

The loop has been idle since 2026-05-01 (per [diagnostic/_state.md](_state.md)). The current visualization stack is mature:

| Layer | What exists | Source |
|---|---|---|
| Chart-type union | 17 entries | [chart-types.ts:7-25](../web/src/lib/chart-types.ts#L7-L25) |
| Renderer dispatcher | 22 components + fallback | [charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx) |
| Detector registry | 16 detectors | [detectors/registry.ts](../web/src/lib/mapInsight/detectors/registry.ts) |
| Synthesis prompt templates | 6 shapes (hero / verdict / metric-grid / composite / refusal / chart-with-metrics) | [buildSynthesisPrompt.ts:332-349](../web/src/lib/synthesis/buildSynthesisPrompt.ts#L332-L349) |
| Implemented fixtures | 21 (M01–M22 excl. M07/M23) | [manifest.ts:300](../web/src/__mocks__/insights/manifest.ts#L300) |
| Follow-up fixtures | M07, M23 | same file:303 |
| Existing visualization contract test | passes against `diagnostic/v0_visualization_expectations.json` | [visualization-contract.test.ts](../web/scripts/tests/visualization-contract.test.ts) |
| Existing `/mock` page | renders the 21 implemented fixtures | [web/src/app/mock/page.tsx](../web/src/app/mock/page.tsx) |

The 25 screenshots represent the chat product's expected response cards. All 25 map to existing chart types / detectors / renderers (M07 + M23 not required by any screenshot — see §0). The work below is therefore:

1. **Inventory** — make the screenshot corpus machine-readable + linked to fixtures.
2. **Verify** — confirm each fixture's row shape, detector match, renderer styling, and live-data path actually work end-to-end.
3. **Refactor** — close the architecture debt (`ChartSpec` discriminated union, remove `as any`) before any new chart shape ever lands.
4. **Polish** — bring the outer card shell + each chart to pixel-parity with the screenshots.
5. **Lock in** — visual regression gates + live-capture fixtures so drift surfaces in CI, not in production.

---

## 2 · Target architecture (4 contracts)

### Contract A — Screenshot manifest

`docs/f1-visualizations/manifest.json` — every PNG mapped to one of: `{fixture_id, visual_id, prompt, sample_qid, status, variant?, notes?}` or `{status: "discard", reason: ...}`. Validated by a check script that asserts every file in the directory has an entry and every referenced file exists.

### Contract B — Typed visual data

`ChartSpec` becomes a discriminated union. Each renderer receives only its matching variant. No `as any` casts in [charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx). Top-level card slots (`hero`, `verdict`, `metrics`, `composite`, `refusal`) become explicit `InsightCardProps` fields, not synthetic chart types.

### Contract C — Live adapter selection

Each benchmark qid in `diagnostic/v0_visualization_expectations.json` maps to a required visual. The chain `live SQL rows → runDetectorRegistry → ChartSpec → ChartRenderer` must produce the expected visual. Top-level non-chart shapes go through semantic passes (`applyScalarHero`, `applyVerdictSemantics`, etc.).

### Contract D — Visual regression

Playwright baselines under `web/tests/visual-baselines/{mock,live,screenshot}/`. Three test levels: fixture (every implemented mock), live (captured `ChatApiResponse` per qid), screenshot (corpus replay). Diff tolerances per Decision 5.

---

## 3 · Phase plan (8 phases, slice-formatted)

Each phase produces one or more slices ready for `/run-loop`. Slice IDs use `viz-<phase>-<topic>` so the runner's `_index.md` ordering is deterministic.

---

### Phase 1 — Screenshot source of truth · 0.5 days

#### Slice `viz-01-screenshot-manifest`

**Goal**: every PNG in `docs/f1-visualizations/` is classified and linked to a fixture.

**Steps**:
1. Read all 25 PNGs; record dimensions to identify any anomalies (Codex flagged a possible `15x4` micro-crop — re-verify by `file` / `identify` on each).
2. For each PNG, transcribe the prompt text from the user-message box and the visible chart type.
3. Map each PNG to a fixture from [manifest.ts](../web/src/__mocks__/insights/manifest.ts) using the visible chart type + prompt + race. Where a PNG matches an implemented fixture, set `status: "implemented"`. Where it matches a follow-up (M07/M23), set `status: "follow_up"` (none expected per §0). Where it's a tiny crop / duplicate, set `status: "discard"` with `reason`.
4. Write [docs/f1-visualizations/manifest.json](../docs/f1-visualizations/) with one entry per file.
5. Write [diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md](./) as the human-readable counterpart.
6. Add `web/scripts/health/validate-screenshot-manifest.ts` — asserts every PNG in the dir has an entry; every entry references an existing file; every `implemented` entry's `fixture_id` exists in `IMPLEMENTED_FIXTURES`; every `discard` entry has a `reason`.

**Changed files expected**:
- `docs/f1-visualizations/manifest.json`
- `diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md`
- `web/scripts/health/validate-screenshot-manifest.ts`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npx tsx scripts/health/validate-screenshot-manifest.ts
```

**Acceptance**:
- 100% of 25 PNGs classified.
- Zero anonymous screenshots; zero broken file references.
- All `implemented` entries map to a real fixture ID.

---

### Phase 2 — Coverage matrix · 0.25 days

#### Slice `viz-02-coverage-matrix`

**Goal**: one table that ties every screenshot to every layer (fixture, renderer, detector, SQL source, status).

**Steps**:
1. Build `diagnostic/f1_visualization_coverage_matrix_2026-05-25.md` with one row per screenshot.
2. Columns: `visual_id, screenshot_file, fixture_id, chart_type, renderer, top_level_slot, detector_id, required_row_fields, synthesis_fields, backend_sources, status, blocking_gap`.
3. Populate `required_row_fields` by reading each detector's `matches()` predicate.
4. Populate `backend_sources` by tracing the qid's expected SQL path (matview + relevant joins). For fixtures with no live qid mapped, mark `backend_sources: "(fixture-only)"`.
5. Also emit `diagnostic/f1_visualization_coverage_matrix.json` for downstream tooling.
6. Add a Vitest assertion in `visualization-contract.test.ts` that loads the JSON, walks each row, and asserts the referenced fixture / renderer / detector all exist.

**Changed files expected**:
- `diagnostic/f1_visualization_coverage_matrix_2026-05-25.md`
- `diagnostic/f1_visualization_coverage_matrix.json`
- `web/scripts/tests/visualization-contract.test.ts` (extended)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

**Acceptance**:
- Matrix covers all 25 screenshot-manifest entries.
- Every `implemented` row has a non-empty detector / renderer / required_row_fields.
- Every `blocking_gap` cell is either empty or a specific actionable line.

---

### Phase 3 — Renderer completeness + architecture debt · 2 days

This phase has two parallel slices since they touch disjoint code.

#### Slice `viz-03a-discriminated-chart-spec`

**Goal**: replace flat `ChartSpec` with a discriminated union; remove all `as any` casts in [charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx).

**Steps**:
1. In [chart-types.ts](../web/src/lib/chart-types.ts), define one interface per chart type: `GroupedBarSpec`, `LineSpec`, `HorizontalBarSpec`, `RadarSpec`, etc. Each has `type` as a literal string discriminator + the fields *that variant actually uses* (no shared optional bag).
2. Export `ChartSpec` as the union of all variants.
3. Update each component under [charts/](../web/src/components/f1-chat/charts/) to accept its variant directly: `interface RadarChartProps { chart: RadarSpec; … }`.
4. Update [charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx) so the `switch` narrows automatically; remove every `as any`.
5. Update detector `build()` functions to return the correct variant type. Compiler will tell you what's missing.
6. Update [manifest.ts](../web/src/__mocks__/insights/manifest.ts) fixtures to satisfy the narrower types.

**Changed files expected**:
- `web/src/lib/chart-types.ts`
- `web/src/components/f1-chat/charts/*.tsx`
- `web/src/components/f1-chat/charts/index.tsx`
- `web/src/lib/mapInsight/detectors/registry.ts`
- `web/src/__mocks__/insights/*.ts` (each fixture file)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run lint
cd web && npm run test:adapter
```

**Acceptance**:
- `grep -c 'as any' web/src/components/f1-chat/charts/index.tsx` returns 0.
- `npm run typecheck` passes with the new discriminated union.
- `/mock` page renders all 21 implemented fixtures unchanged.

#### Slice `viz-03b-top-level-card-slots`

**Goal**: hero / verdict / metric-grid / composite / refusal become explicit `InsightCardProps` slots, not synthetic chart types in `ChartSpec`.

**Steps**:
1. Audit [chart-types.ts:138-160](../web/src/lib/chart-types.ts) and the `InsightCard` props for which top-level fields are passed through which mechanism.
2. Move `hero`, `verdict`, `metrics`, `composite`, `refusal` into `InsightCardProps` if not already.
3. Update [mapInsight.ts](../web/src/lib/mapInsight.ts) `applyResponseSemantics` / `applyScalarHero` / `applyVerdictSemantics` to write into the new slots.
4. Ensure synthesis prompts ([buildSynthesisPrompt.ts](../web/src/lib/synthesis/buildSynthesisPrompt.ts)) emit JSON matching the new slot shape.
5. Remove any `chart.type === "metric_grid"` fakery from `ChartRenderer` (metrics is a card-level slot, not a chart).

**Changed files expected**:
- `web/src/lib/chart-types.ts`
- `web/src/lib/mapInsight.ts`
- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/components/f1-chat/insight-card.tsx`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

**Acceptance**:
- Hero / verdict / refusal cards render via dedicated slots, not via `ChartRenderer`.
- `/mock` page still renders M01 (hero), M02 (verdict), M21 (refusal), M20 (composite) correctly.

---

### Phase 4 — Data contracts per visual · 1.5 days

#### Slice `viz-04-visualization-contracts`

**Goal**: every visual has a documented row-data contract + a known SQL source.

**Steps**:
1. Create `web/src/lib/visualizationContracts.ts`:
   ```ts
   export interface VisualContract {
     visual_id: string;
     required_row_fields: { name: string; type: 'string'|'number'; pattern?: RegExp }[];
     optional_row_fields: { name: string; type: 'string'|'number' }[];
     synthesis_fields: ('title'|'subtitle'|'body'|'metrics'|'key_takeaways'|'related_questions'|'hero'|'verdict'|'refusal')[];
     backend_source: string;  // e.g. "analytics.corner_speed_by_driver"
     adapter_notes?: string;
   }
   export const VISUAL_CONTRACTS: Record<string, VisualContract> = { … };
   ```
2. Populate one entry per chart type (17 total) referencing the coverage matrix from Phase 2.
3. Extend `visualization-contract.test.ts` to assert each contract's `required_row_fields` are produced by the corresponding fixture's row shape.
4. Add `web/scripts/health/visualization-contract-sql-check.ts` — runs each contract's `backend_source` SQL against the live DB (when `DATABASE_URL` is set) and verifies the row shape satisfies the contract. Marks contracts that don't have a live-data path as `(fixture-only)` and exits 0 (informational).

**Changed files expected**:
- `web/src/lib/visualizationContracts.ts`
- `web/scripts/tests/visualization-contract.test.ts` (extended)
- `web/scripts/health/visualization-contract-sql-check.ts`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
cd web && DATABASE_URL=$LIVE_DB npx tsx scripts/health/visualization-contract-sql-check.ts
```

**Acceptance**:
- All 17 chart types have a contract entry.
- All 21 implemented fixtures satisfy their declared contract.
- Live SQL check produces a report enumerating which contracts have a working live-data path.

---

### Phase 5 — Detector registry completion · 1 day

#### Slice `viz-05-detector-tolerance-pass`

**Goal**: every benchmark qid that should produce a chart actually triggers the correct detector against live SQL output.

**Steps**:
1. Read [v0_visualization_expectations.json](./v0_visualization_expectations.json) — each qid declares `expected_visual`.
2. For each qid:
   - If `(fixture-only)` per Phase 4: skip (no live path to check).
   - Otherwise, run the qid's SQL against live DB.
   - Run `runDetectorRegistry()` on the rows; record `detectorId`.
   - Assert `detectorId` matches the qid's `expected_visual`.
3. For mismatches, propose one of: (a) extend the detector's `matches()` regex set, (b) raise/lower the detector's priority, (c) document an explicit `allowed_fallback` in the expectations JSON.
4. Strengthen detectors that exhibit false matches:
   - `divergingBarDetector` vs `horizontalBarDetector` — only fire for explicit `position_delta` columns.
   - `lineDetector` vs `lineWithStintMarkersDetector` — already guarded; verify.
   - `statusGridDetector` — verify it only fires on actual coverage data, not arbitrary tables.

**Changed files expected**:
- `web/src/lib/mapInsight/detectors/registry.ts`
- `diagnostic/v0_visualization_expectations.json` (annotate allowed fallbacks)
- `web/scripts/tests/detector-coverage.test.ts` (new)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

**Acceptance**:
- Every qid with a non-fallback expected_visual triggers the matching detector.
- No detector has a known false positive against the qid corpus.

---

### Phase 6 — Structured synthesis slot coverage · 1 day

#### Slice `viz-06-synthesis-slot-coverage`

**Goal**: every card's non-chart slots (title / body / metrics / takeaways / chips / hero / verdict / refusal) are reliably populated by structured synthesis, not stuffed into chart body text.

**Steps**:
1. For each of the 6 synthesis templates ([buildSynthesisPrompt.ts:332-349](../web/src/lib/synthesis/buildSynthesisPrompt.ts#L332-L349)), check the JSON schema it requests against the screenshot's visible slots.
2. Verify that `applyResponseSemantics` in [mapInsight.ts](../web/src/lib/mapInsight.ts) correctly merges the structured response into `DraftInsight`.
3. Add a `lib/synthesisSchema.ts` Zod schema per shape; route LLM JSON through it; on parse failure, log + degrade gracefully to a body-only card.
4. Add parse-rate telemetry: count of well-formed synthesis responses vs. degraded vs. error, per shape. Surface in cost ledger.
5. Confirm that screenshot #22 (Imola composite — verdict + line + tiles) actually round-trips through the `composite` template successfully.

**Changed files expected**:
- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/lib/synthesis/synthesisSchema.ts` (new)
- `web/src/lib/mapInsight.ts`
- `web/src/lib/anthropic.ts` (or wherever synthesis is dispatched)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

**Acceptance**:
- All 6 shape templates have a Zod schema; parse-rate is logged.
- M20 composite fixture renders the verdict + chart + metrics + takeaways together.
- No screenshot's card renders as chart-only body text in the parity harness.

---

### Phase 7 — Visual regression + parity · 2 days

This phase has two slices: an interim harness (cheap, fast) and the durable Playwright suite.

#### Slice `viz-07a-parity-harness-dev-route`

**Goal**: a dev-only page that renders every screenshot's ChartSpec stacked, for visual diff against the PNG corpus.

**Steps**:
1. Create `web/src/app/_dev/screenshot-parity/page.tsx`, gated by `process.env.NODE_ENV !== 'production'`.
2. Create `web/scripts/health/screenshot-specs.ts` with one `ChartSpec` literal per screenshot (built either by hand-transcription or by running each fixture through the detector and capturing the output).
3. The dev page imports those specs and renders them with the screenshot filename as a label above each card.
4. Capture the resulting renders to `diagnostic/artifacts/screenshot-parity-2026-05-25/<n>.png` via Playwright headless mode.
5. Author `diagnostic/artifacts/screenshot-parity-2026-05-25.md` comparing each rendered card to the source screenshot: `matches | minor drift | major divergence | data-shape mismatch`.

**Changed files expected**:
- `web/src/app/_dev/screenshot-parity/page.tsx`
- `web/scripts/health/screenshot-specs.ts`
- `diagnostic/artifacts/screenshot-parity-2026-05-25/`
- `diagnostic/artifacts/screenshot-parity-2026-05-25.md`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run dev &   # render server
sleep 5 && curl -fsS http://localhost:3000/_dev/screenshot-parity > /dev/null
```

**Acceptance**:
- Dev page renders all 25 cards without runtime errors.
- Parity report classifies every card with a one-line description.

#### Slice `viz-07b-playwright-visual-baselines`

**Goal**: durable visual regression. CI fails when a chart drifts from baseline.

**Steps**:
1. Install Playwright (`cd web && npm i -D @playwright/test`); add `playwright.config.ts` with desktop / tablet / mobile viewports.
2. Author `web/tests/visual/fixture.spec.ts` — for each implemented fixture, navigate to `/mock?id=<fixture_id>`, take a screenshot, compare to `web/tests/visual-baselines/mock/<fixture_id>.png` with the Decision-5 tolerance.
3. Author `web/tests/visual/screenshot-corpus.spec.ts` — uses the dev-route harness from 07a; one snapshot per screenshot manifest entry.
4. Add `npm run test:visual` script; wire into `verify:ui` only after baselines are approved.
5. First run produces the baselines; commit them. Subsequent runs diff against them.

**Changed files expected**:
- `web/playwright.config.ts`
- `web/tests/visual/*.spec.ts`
- `web/tests/visual-baselines/mock/m*.png`
- `web/tests/visual-baselines/screenshot/*.png`
- `web/package.json` (test:visual script)

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:visual    # first run creates baselines
```

**Acceptance**:
- All 21 fixture cards have approved baselines.
- All 25 screenshot-corpus renders have approved baselines.
- Re-running `test:visual` shows zero drift on a clean checkout.

---

### Phase 8 — Live benchmark capture · 1.5 days

#### Slice `viz-08-live-response-fixtures`

**Goal**: real prompts produce the expected visuals — captured as fixtures so the loop's audit step can replay them.

**Steps**:
1. Pick a representative benchmark qid for each of the 21 implemented visuals (use the `benchmarkQids` arrays in [manifest.ts](../web/src/__mocks__/insights/manifest.ts)).
2. For each qid: run the live chat through the API, capture the final `ChatApiResponse` JSON (rows, SQL, synthesis insight fields, resulting `DraftInsight`).
3. Sanitize (strip session-key noise; leave deterministic fields).
4. Store under `web/scripts/fixtures/visualization-responses/q<qid>.json`.
5. Add `web/tests/visual/live.spec.ts` — for each captured response, replay through `mapInsight.ts`, render at `/dev/replay?qid=<qid>`, screenshot, compare to `web/tests/visual-baselines/live/q<qid>.png`.
6. Update `npm run verify:ui` to include the live spec after baselines are approved.

**Changed files expected**:
- `web/scripts/fixtures/visualization-responses/q*.json`
- `web/src/app/_dev/replay/page.tsx`
- `web/tests/visual/live.spec.ts`
- `web/tests/visual-baselines/live/q*.png`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:visual
```

**Acceptance**:
- At least one captured response per implemented visual (21 total).
- All non-fallback live responses render to the expected visual type.
- Allowed fallbacks (per Phase 5) are documented with reason.

---

### Phase 9 — Card-shell polish · 1 day

#### Slice `viz-09-card-shell-parity`

**Goal**: the outer card shell — red dot + title + race subtitle + narrative + chart + KEY TAKEAWAYS + EXPLORE FURTHER chips — matches the screenshots within Decision-5 tolerance.

**Steps**:
1. Locate the outer card component (likely `web/src/components/f1-chat/insight-card.tsx` after Phase 3b's slot work).
2. Side-by-side with screenshot #1 (Suzuka esses), identify deltas: header dot diameter / color, title weight, race-subtitle size / opacity, divider line color / opacity, KEY TAKEAWAYS label letter-spacing, dash-prefix color on each bullet, EXPLORE FURTHER chip pill border / background / text color.
3. Update the shared shell. Single source of truth: card-level CSS variables in `globals.css` or a `card-tokens.ts` module.
4. Re-run Phase 7's parity harness; the report should show zero "major divergence" entries.

**Changed files expected**:
- `web/src/components/f1-chat/insight-card.tsx`
- `web/src/app/globals.css` or `web/src/lib/card-tokens.ts`

**Gate commands**:
```bash
cd web && npm run typecheck
cd web && npm run test:visual
```

**Acceptance**:
- All 25 screenshots' renders classified as `matches` or `minor drift` only.
- No CSS overrides at the per-card level — shell styling flows from card-level tokens.

---

## 4 · Implementation order + work-day totals

| Phase | Slice(s) | Work-days | Elapsed days | Notes |
|---|---|---:|---:|---|
| 1 | viz-01 | 0.5 | 1 | Manifest + validator |
| 2 | viz-02 | 0.25 | 1 | Coverage matrix |
| 3 | viz-03a + viz-03b | 2 | 2 | Discriminated union + slot refactor (parallel-able) |
| 4 | viz-04 | 1.5 | 2 | Contracts + live SQL check |
| 5 | viz-05 | 1 | 1 | Detector tolerance |
| 6 | viz-06 | 1 | 1 | Synthesis slots + Zod |
| 7 | viz-07a + viz-07b | 2 | 2 | Dev harness + Playwright |
| 8 | viz-08 | 1.5 | 2 | Live capture |
| 9 | viz-09 | 1 | 1 | Card-shell polish |
| | **Total** | **10.75d** | **13 days** | |

**Critical path**: Phase 1 → Phase 3 → Phase 4 → Phase 7 → Phase 8. Phase 2 + Phase 5 + Phase 6 + Phase 9 are nearly independent and can shift within the schedule.

---

## 5 · Risk + rollback per phase

| Phase | Failure mode | Rollback |
|---|---|---|
| 1 | Manifest validator catches drift; PNG-to-fixture mapping ambiguous | Manifest is doc + validator; no runtime impact. Roll back by deleting the new files. |
| 2 | Matrix has gaps the validator can't auto-detect | Matrix is doc; gaps surface in Phase 3+ regardless. |
| 3a | Discriminated union refactor breaks the build mid-flight | Revert via `git revert`; the existing flat type still compiles. Stage the refactor per chart type, not in one giant commit. |
| 3b | Top-level slot move regresses M01/M02/M21 rendering | Revert; the prior synthetic-chart-type path still works. |
| 4 | Live SQL check fails because `DATABASE_URL` unavailable | Script exits 0 with "no DB" notice; doesn't block. |
| 5 | Detector regex changes cause false negatives on production queries | Detectors are pure functions; revert is the regex change. Cost ledger surfaces drift quickly. |
| 6 | Zod schema rejection causes synthesis to degrade unnecessarily | Permissive parse-first, strict-second: schema *logs* failures before enforcing. |
| 7a | Dev route accidentally ships in production | Gated by `process.env.NODE_ENV !== 'production'`; verify in build. |
| 7b | Playwright baselines too strict; CI flaky on AA differences | Decision-5 tolerance is permissive for AA; if still flaky, raise tolerance per-test. |
| 8 | Live responses drift between capture and replay | Sanitization strips non-deterministic fields; if a field is genuinely non-deterministic, omit from baseline assertion. |
| 9 | Card-shell tokens cascade-break per-card overrides | Phase 9 is the LAST work; if it breaks, revert to the pre-polish shell. |

---

## 6 · Done definition

- Every screenshot in [docs/f1-visualizations/](../docs/f1-visualizations/) is classified in the manifest.
- Every implemented visual has a typed contract + a known SQL source + a passing detector.
- Every visual renders at `/mock` AND at `/_dev/screenshot-parity` without fallback "not implemented" UI.
- `ChartSpec` is a discriminated union; zero `as any` in [charts/index.tsx](../web/src/components/f1-chat/charts/index.tsx).
- Playwright visual baselines exist for fixtures, screenshots, and live captures; `npm run verify:ui` passes.
- For each of the 21 implemented visuals, at least one live captured response exists.
- M07 + M23 remain explicitly deferred (per Decision 1 + 2); the manifest does not reference them as required.

---

## 7 · How to invoke

```
/run-loop diagnostic/f1_visualizations_combined_plan_2026-05-25.md
```

The skill will read this file, propose the 10-slice decomposition (Phase 1–9 = 10 slices counting the two splits in Phases 3 and 7), wait for confirmation, then write slice files into `diagnostic/slices/` and start the runner.

**Recommended kickoff order**:
1. Approve only Phase 1 + 2 first. They produce docs + validators with no runtime risk. Manifest + matrix become the foundation for everything below.
2. Once Phase 1+2 ship, approve Phase 3 (discriminated union + slot refactor). This is the largest refactor and benefits from being in its own iteration window.
3. Phase 4–8 can run as a single batch once Phase 3 lands — the detector / synthesis / visual / capture work is largely independent.
4. Phase 9 ships last; it's pure CSS / token work and depends on Phase 7's baselines existing to be verifiable.

---

## 8 · Source attribution

This plan combines:
- **Codex's [data + styling roadmap](./f1_visualizations_data_styling_roadmap_2026-05-25.md)** — 8-phase architecture, discriminated union refactor, M07/M23 follow-ups, Playwright visual regression, live benchmark capture, architectural decisions framework.
- **The [verification-first coverage roadmap](./f1_visualization_coverage_roadmap_2026-05-25.md)** — slice-formatted decomposition, dev-page parity harness, card-shell polish as a discrete slice, lower-risk Phase 1 framing.

What this combined plan *adds* on top of both:
- Decisions §0 — resolves Codex's 6 open questions with rationale.
- Phase 9 (Card-shell polish) — split from styling work into its own iteration.
- Phase 7a (dev harness) + 7b (Playwright) — two-step approach: cheap first, durable second.
- Concrete work-day totals + critical-path identification.
- Per-phase risk/rollback table.

The two predecessor plans remain on disk for reference; this is the canonical version.
