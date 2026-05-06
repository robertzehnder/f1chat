# V0 Exact Visualization Match Plan - 2026-05-06

## Goal

Make every F1 Insights visualization in this repo match the v0 frontend exactly,
while preserving the existing backend, `/api/chat` SSE contract, Neon access,
resolver logic, grading harness, and runtime libraries.

This is different from "the UI works." The target is:

- Every v0 card layout, chart renderer, token, spacing rhythm, empty state,
  loading state, and responsive behavior is reproduced in `web/src/`.
- Every benchmark response shape maps into the same visual component that v0
  designed for that shape.
- The existing backend remains the data and intelligence layer. The frontend
  only adapts backend `MessagePart` / `ChatApiResponse` payloads into v0 card
  props.

## Current Starting Point

The repo already has a substantial v0 import:

- `web/src/components/f1-chat/**` contains the v0 chat shell and chart surface.
- `web/src/components/f1-chat/charts/**` contains renderers for the 21
  currently in-scope mock fixtures.
- `web/src/__mocks__/insights/**` contains 21 split fixtures plus `_source.ts`.
- `web/src/lib/chart-types.ts` defines `InsightMock`, `DraftInsight`, and
  `ChartSpec`.
- `web/src/lib/mapInsight.ts` folds backend SSE parts into `DraftInsight`.
- `web/src/lib/toCardProps.ts` adapts fixture/runtime shapes into
  `InsightCard` props.
- `web/src/app/mock/page.tsx` is the visual QA surface.

Known deliberate gaps from the migration plan:

- M07 `horizontal_bar_team_grouped` is not implemented as its own renderer.
- M23 `track_marker_map` is not implemented as its own renderer.
- `mapInsight.ts` only auto-detects Tier 1 chart families today.
- Some renderer paths still use broad `as any` casts.
- The v0 source drop path referenced by older plan text is not currently
  present as `_v0_drop/f1-chat-v0`; the imported code and `_source.ts` are the
  local source of truth unless the original v0 export is restored.

## Architectural Principles

1. Backend preservation is non-negotiable.
   `web/src/app/api/**` and backend runtime libs stay functionally unchanged.
   Any visual work happens in components, fixtures, adapters, and type
   definitions.

2. V0 owns the frontend visual language.
   Do not remap v0 back onto the old F1 UI. Preserve v0 globals, card shell,
   sidebar, chart treatment, typography, dark theme, and spacing unless a
   deliberate product decision says otherwise.

3. Use a typed boundary, not ad hoc row sniffing everywhere.
   Backend rows enter through `mapInsight.ts`; components consume `ChartSpec`,
   `InsightMock`, `DraftInsight`, and `InsightCardProps`.

4. Exactness needs visual regression, not just typecheck.
   Recharts output and CSS spacing can be "type-correct" but visually wrong.
   `/mock` screenshots are a merge gate.

5. Fixture parity and live parity are separate gates.
   `/mock` proves the v0 renderer surface. Adapter tests prove backend payloads
   route to the right renderer. Browser smoke proves the two are wired together.

## Phase A - Establish The V0 Visual Source Of Truth

### A1. Restore or declare the canonical v0 baseline

Choose one of two paths before implementing more exact-match work:

- Preferred: restore the original v0 export under a stable ignored path such as
  `_v0_reference/f1-chat-v0/` and keep it read-only.
- Fallback: declare current imported files plus `web/src/__mocks__/insights/_source.ts`
  as the canonical v0 baseline for this repo.

Acceptance:

- A `diagnostic/v0_visual_source_of_truth.md` file states which baseline is
  canonical.
- If the original v0 export is restored, add a checksum manifest for source
  files that are expected to match copied code.
- If using the fallback, explicitly state that exactness means exact against the
  imported v0 state, not an unavailable external export.

### A2. Build a fixture manifest

Add `web/src/__mocks__/insights/manifest.ts`:

```ts
export type InsightFixtureManifestEntry = {
  id: "m01" | "m02" | "...";
  title: string;
  mockFile: string;
  sourceExport: string;
  chartType?: string;
  renderer: string;
  status: "implemented" | "follow_up";
  benchmarkQids: number[];
};
```

Acceptance:

- Manifest includes all 23 visualization mocks from the brief, not only the
  current 21.
- M07 and M23 are present with `status: "follow_up"` until implemented.
- `/mock` renders from the manifest so fixture coverage cannot drift from docs.

## Phase B - Close Renderer Coverage To All 23 V0 Visualizations

### B1. Implement M07 team-grouped horizontal bar

Architectural consideration:

- M07 is not just M06 with colors. It needs a team side strip / grouping layer,
  teammate adjacency handling, and labels that still work when teams are
  missing from live rows.

Changes:

- Add chart type `horizontal_bar_team_grouped`.
- Add `teams?: string[]` or per-row team metadata to `ChartSpec`.
- Add `TeamGroupedHorizontalBarChart`.
- Register it in `ChartRenderer`.
- Add `m07-team-grouped-ranking.ts` fixture.
- Add a `mapInsight.ts` detector branch for rows with ranking metric plus team
  metadata, or a deterministic fallback from driver name to team color.

Acceptance:

- M07 renders in `/mock` and is no longer marked follow-up.
- Adapter fixture for a speed-trap / straight-line result routes to
  `horizontal_bar_team_grouped`.
- If live backend cannot provide team identity, the renderer falls back to
  team-color inference without crashing.

### B2. Implement M23 track marker map

Architectural consideration:

- M23 requires a track coordinate system. The v0 mock uses normalized
  `x_track_pct` / `y_track_pct`, but live OpenF1 rows may contain corner labels,
  lap-distance, GPS-like coordinates, or no track position at all.

Changes:

- Add chart type `track_marker_map`.
- Add `TrackMarkerMap` renderer.
- Add `markers?: Array<{ lap?: number; corner?: string; x_track_pct?: number;
  y_track_pct?: number; label: string; color?: string }>` to `ChartSpec`.
- Add a circuit outline source strategy:
  - Phase 1: simplified SVG placeholders for benchmark circuits used by M23.
  - Phase 2: normalized path assets per venue.
- Add `m23-track-marker-map.ts` fixture.
- Add mapInsight detector for overtake-location rows when marker coordinates
  or corner names are available.

Acceptance:

- M23 renders in `/mock`.
- Missing coordinates show a clear body/table fallback, not a broken map.
- The renderer supports at least Imola, Singapore, and one generic fallback.

## Phase C - Normalize The Visualization Contract

### C1. Move from flat optional `ChartSpec` toward discriminated unions

Current `ChartSpec` is intentionally broad so v0 fixtures typecheck. For exact
matching and safer live mapping, introduce a discriminated union gradually:

```ts
type ChartSpec =
  | GroupedBarSpec
  | HorizontalBarSpec
  | TeamGroupedHorizontalBarSpec
  | TrackMarkerMapSpec
  | ...
```

Architectural considerations:

- Recharts renderers should not need `as any`.
- `mapInsight.ts` builders should return the exact spec type.
- Fixture files should fail typecheck when they put fields on the wrong chart
  family.
- `CompositeCard` needs its own sub-spec union because M20 embeds mini charts.

Acceptance:

- Remove `as any` casts in `ChartRenderer`.
- Every renderer receives a narrowed type.
- `npm run typecheck` catches at least one intentional bad fixture in a local
  negative type test or `satisfies` fixture assertion.

### C2. Define live row to chart mapping as a registry

Replace one growing `detectChart()` function with a registry:

```ts
type ChartDetector = {
  id: string;
  priority: number;
  matches(rows: RowSet, context: AdapterContext): boolean;
  build(rows: RowSet, context: AdapterContext): ChartSpec;
  fixtures: string[];
  benchmarkQids: number[];
};
```

Architectural considerations:

- Detector priority must prevent scalar hero answers from becoming one-bar
  charts.
- Some detectors need question/category context, not just columns.
- Some supported chart types share similar row shapes.
- Detection must be deterministic for adapter tests.

Acceptance:

- One detector entry exists for each implemented chart type.
- Adapter tests assert detector id, not just chart type, for ambiguous shapes.
- Registry exposes coverage reports: chart types with fixture but no live
  detector, and live detectors with no fixture.

## Phase D - Exact Visual Regression Infrastructure

### D1. Add screenshot parity for `/mock`

Use Playwright or the repo's preferred browser automation to capture `/mock`:

- Desktop: 1440 x 1200.
- Laptop: 1280 x 900.
- Mobile: 390 x 844.

Architectural considerations:

- Recharts animations must be disabled or stabilized for screenshots.
- Fonts must load deterministically.
- Dynamic IDs in gradients/clip paths can create snapshot noise.
- Dark theme must be forced consistently.

Acceptance:

- `npm run test:visual:mocks` captures all fixtures and compares against
  committed baselines.
- First pass may allow a small pixel threshold, but exact-match work should
  ratchet the threshold down over time.
- M01-M23 each have a stable `data-testid` wrapper.

### D2. Add screenshot parity for live adapter outputs

Create a `/mock/live-fixtures` route that renders captured
`ChatApiResponse` payloads through the real pipeline:

`ChatApiResponse -> mapChatApiResponseToParts -> foldPartsIntoInsight ->
applyResponseSemantics -> applyScalarHero -> applyVerdictSemantics ->
applyQuestionTitle -> toCardProps -> InsightCard`

Acceptance:

- At least one captured live payload per chart type.
- Visual snapshots prove the live pipeline matches the fixture pipeline.
- Snapshot labels include qid and detector id.

## Phase E - Backend-To-Frontend Adapter Completeness

### E1. Capture adapter fixtures from the 167-question benchmark

Add a script:

```sh
cd web
npm run capture:adapter-fixtures -- --baseline ../diagnostic/phase_19_baseline_*.json
```

Output:

- `web/scripts/tests/fixtures/chat-api/q####.json`
- `diagnostic/v0_chart_mapping_report_YYYY-MM-DD.md`

Report columns:

- qid
- category
- baseline grade
- generationSource
- expected chart family
- detected chart family
- detector id
- has hero/verdict/refusal/composite
- missing fields
- fallback reason

Acceptance:

- Every A/B benchmark answer maps to one of:
  - implemented chart
  - hero/verdict/no-data/composite
  - explicit body/table fallback with reason
- No silent "unknown chart type" for fixture-backed chart types.

### E2. Add per-category visualization expectations

Create `diagnostic/v0_visualization_expectations.json`:

```json
{
  "qid": 1922,
  "expected_visual": "hero",
  "required_fields": ["hero.value", "hero.label"],
  "allowed_fallback": false
}
```

Architectural considerations:

- This should complement, not replace, grading rubrics.
- It tests presentation shape, not factual correctness.
- It should be stable even when SQL rows change slightly.

Acceptance:

- `npm run test:adapter` validates the expectation manifest.
- A question that should be M08 cannot silently render as a table-only card.

## Phase F - Responsive And Interaction Fidelity

### F1. Responsive card and chart sizing

Audit every chart for:

- Minimum readable height on mobile.
- Axis tick overlap.
- Legend wrapping.
- Horizontal scrolling where charts are inherently wide.
- Tooltip usability on touch devices.

Acceptance:

- Mobile screenshots for all 23 mocks.
- No chart overflows the card container at 390 px width.
- Tables and SQL blocks scroll internally without breaking page width.

### F2. Interaction parity

Audit:

- Sidebar collapse/open behavior.
- Suggested prompt chips.
- Follow-up question chips.
- SQL disclosure.
- Reasoning disclosure.
- Activity log live/complete states.
- Empty / loading / error states.

Acceptance:

- Browser smoke covers one happy path, one refusal, one SQL error/empty table,
  and one streaming response.
- Keyboard focus order is usable for input, chips, SQL disclosure, and sidebar.

## Phase G - Theme, Assets, And Design Tokens

### G1. Token ownership

Preserve v0 globals as canonical, but document the bridge values:

- F1 red accent.
- Team color palette.
- Compound colors.
- Chart semantic colors.
- Muted/refusal treatment.
- Card border/background values.

Architectural considerations:

- `web/src/lib/teamColors.ts` and `web/src/lib/f1-team-colors.ts` should not
  diverge silently.
- Chart renderers should consume a single team-color helper.
- Compound color constants should live in one shared module.

Acceptance:

- One color-source module exports team and compound colors.
- Fixtures and live builders use the same module.
- Visual snapshots catch accidental token drift.

### G2. Font and CSS determinism

Architectural considerations:

- Next font loading can affect screenshot exactness.
- Tailwind class generation depends on content globs.
- Recharts may render differently if container dimensions settle late.

Acceptance:

- `/mock` waits for fonts and chart layout before screenshot capture.
- Tailwind content globs include fixtures and components.
- No chart has layout shift after first paint in screenshot tests.

## Phase H - Exact Match Gates

Add these scripts to `web/package.json`:

```json
{
  "test:visual:mocks": "playwright test tests/visual/mock-fixtures.spec.ts",
  "test:visual:live": "playwright test tests/visual/live-fixtures.spec.ts",
  "test:visualization-contract": "tsx --test scripts/tests/visualization-contract.test.ts",
  "verify:ui": "npm run typecheck && npm run test:adapter && npm run test:visualization-contract && npm run test:visual:mocks"
}
```

Final exact-match acceptance:

- All 23 mocks render.
- All 23 have screenshot baselines.
- Live captured payloads cover every chart type used by the benchmark suite.
- No implemented v0 chart type falls back to body/table unless explicitly
  allowed by `v0_visualization_expectations.json`.
- Existing backend benchmark A-rate does not regress.
- Existing backend lib files remain unchanged except documented UI adapter
  files.

## Suggested Implementation Order

1. Source-of-truth declaration and manifest.
2. M07 renderer and fixture.
3. M23 renderer and fixture.
4. Visualization expectation manifest for all benchmark qids.
5. Detector registry replacing monolithic `detectChart()`.
6. Screenshot harness for `/mock`.
7. Live adapter fixture capture and screenshot route.
8. Discriminated `ChartSpec` cleanup and `as any` removal.
9. Token/color consolidation.
10. Final responsive and interaction sweep.

## Risk Register

| Risk | Severity | Mitigation |
|---|---:|---|
| "Exact match" is undefined because the original v0 export is unavailable | High | Restore original export or declare the imported current v0 code as canonical before proceeding |
| Live backend rows do not contain enough semantic fields to choose the exact v0 chart | High | Add expectation manifest plus detector fallback reasons; update SQL/matviews only if a visual contract requires a missing field |
| M23 requires real track geometry, not just React work | High | Start with normalized marker coordinates and generic fallback; add SVG circuit assets incrementally |
| Flat `ChartSpec` lets wrong fixture fields pass typecheck | Medium | Migrate to discriminated unions after renderer coverage is complete |
| Recharts screenshots are flaky | Medium | Disable animations, wait for fonts/layout, use deterministic dimensions |
| Visual snapshots slow CI too much | Medium | Run full visual suite in PR gate, lightweight adapter/type gates on every local verify |
| Backend changes sneak into UI PR | High | Keep backend diff allow-list and backend benchmark parity gate |

## Open Questions

1. Is the original v0 export recoverable, or should the imported current code
   become the canonical baseline?
2. Do we want M07 and M23 in the exact-match milestone, or are they allowed to
   remain documented follow-ups?
3. Should visual snapshots be committed as PNGs, Playwright snapshots, or a
   generated artifact under `diagnostic/`?
4. Should chart selection be driven by benchmark qid/category metadata,
   result-row shape, or both?
5. Should SQL/table/reasoning disclosures be considered part of v0 exactness,
   or accepted as repo-specific additions because the existing backend exposes
   them?

## Bottom Line

The current frontend is past the risky import stage. The remaining work is an
exactness program: define the canonical v0 baseline, implement the two missing
visual families, replace heuristic drift with a detector registry and
expectation manifest, and add screenshot gates so "matches v0" becomes a
testable claim instead of a visual opinion.
