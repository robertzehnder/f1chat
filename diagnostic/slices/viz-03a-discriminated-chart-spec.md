---
id: viz-03a-discriminated-chart-spec
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-03a-discriminated-chart-spec/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Replace flat `ChartSpec` (optional-field bag) with a discriminated union — one interface per chart type, narrowed automatically by the `type` literal. Remove all `as any` casts in [web/src/components/f1-chat/charts/index.tsx](../../web/src/components/f1-chat/charts/index.tsx) (currently 5).

## Context

- Combined plan Phase 3a
- Architecture debt called out by Codex audit; verified `grep -c 'as any' web/src/components/f1-chat/charts/index.tsx` = 5.
- All 17 chart types must be representable post-refactor.
- This is prerequisite for any new chart shape ever landing (Decision 4 in §0).

## Changed files expected

- `web/src/lib/chart-types.ts`
- `web/src/components/f1-chat/charts/*.tsx` (every chart component)
- `web/src/components/f1-chat/charts/index.tsx`
- `web/src/lib/mapInsight/detectors/registry.ts`
- `web/src/__mocks__/insights/m*.ts` (each fixture file — narrow the type)

## Steps

1. In [chart-types.ts](../../web/src/lib/chart-types.ts), define one interface per chart type: `GroupedBarSpec`, `LineSpec`, `HorizontalBarSpec`, `DivergingBarSpec`, `StackedHorizontalBarSpec`, `RadarSpec`, `ScatterWithRegressionSpec`, `LineDualAxisSpec`, `LineWithStintMarkersSpec`, `TimelineSpec`, `EventTimelineSpec`, `StatusGridSpec`, `StintGanttSpec`, `DonutSpec`, `PitEventStripSpec`, `TrackHeatmapSpec`, `DeltaComparisonSpec`. Each has `type` as a literal string discriminator + ONLY the fields that variant actually uses.
2. Export `ChartSpec` as the union of all variants.
3. Update each component under `charts/` to accept its variant directly: `interface RadarChartProps { chart: RadarSpec; … }`.
4. Update `charts/index.tsx` so the `switch` narrows automatically; remove every `as any`.
5. Update each detector's `build()` return type to its narrowed variant.
6. Update fixture files to satisfy the narrower types (TypeScript compiler will surface every gap).
7. Run typecheck + adapter tests; iterate until clean.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run lint
cd web && npm run test:adapter
```

## Acceptance criteria

- `grep -c 'as any' web/src/components/f1-chat/charts/index.tsx` returns 0.
- `npm run typecheck` passes.
- `/mock` page renders all 21 implemented fixtures unchanged (verify in browser).
- Detector tests still pass.
