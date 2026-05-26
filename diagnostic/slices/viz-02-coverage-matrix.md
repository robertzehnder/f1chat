---
id: viz-02-coverage-matrix
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-02-coverage-matrix/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

One table that ties every screenshot to every layer: fixture, renderer, detector, SQL backend source, status, and blocking gap. Both human-readable markdown and machine-readable JSON.

## Context

- Combined plan Phase 2
- Depends on viz-01 (screenshot manifest must exist).
- Pulls `required_row_fields` from the detector's `matches()` predicates in [web/src/lib/mapInsight/detectors/registry.ts](../../web/src/lib/mapInsight/detectors/registry.ts).
- Pulls `backend_sources` from each qid's expected SQL path (trace via `diagnostic/v0_visualization_expectations.json` if present).

## Changed files expected

- `diagnostic/f1_visualization_coverage_matrix_2026-05-25.md`
- `diagnostic/f1_visualization_coverage_matrix.json`
- `web/scripts/tests/visualization-contract.test.ts` (extended)

## Steps

1. Read `docs/f1-visualizations/manifest.json` (from viz-01).
2. For each manifest entry, populate a row with: `visual_id, screenshot_file, fixture_id, chart_type, renderer, top_level_slot, detector_id, required_row_fields, synthesis_fields, backend_sources, status, blocking_gap`.
3. Derive `chart_type` + `renderer` by looking up `fixture_id` in `IMPLEMENTED_FIXTURES`.
4. Derive `detector_id` by checking which detector in `CHART_DETECTORS` lists the fixture_id in its `fixtures: [...]` array.
5. Derive `required_row_fields` by inspecting the detector's `matches()` source for column names it tests against.
6. Derive `synthesis_fields` by checking what the synthesis shape template ([buildSynthesisPrompt.ts](../../web/src/lib/synthesis/buildSynthesisPrompt.ts)) emits for the fixture's shape (`hero` / `verdict` / `metric-grid` / `composite` / `refusal` / `chart-with-metrics`).
7. Derive `backend_sources` by reading the qid's expected matview path. For fixtures without a live qid mapped, use `"(fixture-only)"`.
8. Write `diagnostic/f1_visualization_coverage_matrix.json` (one object per row).
9. Write `diagnostic/f1_visualization_coverage_matrix_2026-05-25.md` (markdown table mirroring the JSON).
10. Extend `web/scripts/tests/visualization-contract.test.ts` to load the JSON and assert every row's referenced fixture / renderer / detector all exist in code.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

## Acceptance criteria

- Matrix covers all 25 screenshot-manifest entries.
- Every `implemented` row has a non-empty detector / renderer / required_row_fields.
- Every `blocking_gap` cell is either empty (no gap) or an actionable one-line description.
- Test suite passes.
