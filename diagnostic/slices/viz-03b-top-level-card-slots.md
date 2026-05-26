---
id: viz-03b-top-level-card-slots
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-03b-top-level-card-slots/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Hero / verdict / metric-grid / composite / refusal become explicit `InsightCardProps` slots, not synthetic chart types in `ChartSpec`. Top-level non-chart visuals route through dedicated components without going through the chart dispatcher.

## Context

- Combined plan Phase 3b — parallel-able with 3a but should land after it for cleaner types.
- Affects [web/src/lib/mapInsight.ts](../../web/src/lib/mapInsight.ts), [buildSynthesisPrompt.ts](../../web/src/lib/synthesis/buildSynthesisPrompt.ts), the outer card component.

## Changed files expected

- `web/src/lib/chart-types.ts`
- `web/src/lib/chatTypes.ts`
- `web/src/lib/mapInsight.ts`
- `web/src/lib/synthesis/buildSynthesisPrompt.ts`
- `web/src/components/f1-chat/insight-card.tsx`

## Steps

1. Audit current `chart-types.ts` and `InsightCard` props for which top-level fields (hero, verdict, metrics, composite, refusal) pass through which mechanism.
2. Move `hero`, `verdict`, `metrics`, `composite`, `refusal` into `InsightCardProps` if not already.
3. Update `mapInsight.ts` `applyResponseSemantics` / `applyScalarHero` / `applyVerdictSemantics` to write into the new slots.
4. Ensure synthesis prompts emit JSON matching the new slot shape.
5. Remove any `chart.type === "metric_grid"` fakery from `ChartRenderer` (metrics is a card-level slot).
6. Update fixture files (M01 hero, M02 verdict, M03 metric-grid, M20 composite, M21 refusal) to populate the new slots.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

## Acceptance criteria

- Hero / verdict / refusal cards render via dedicated slots, not via `ChartRenderer`.
- `/mock` page still renders M01 (hero), M02 (verdict), M21 (refusal), M20 (composite) correctly.
- No regressions in detector tests.
