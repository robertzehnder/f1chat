---
id: viz-07b-playwright-visual-baselines
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-07b-playwright-visual-baselines/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Durable visual regression. CI fails when a chart drifts from baseline beyond tolerance. Covers fixtures + screenshot-corpus replays.

## Context

- Combined plan Phase 7b
- Depends on viz-07a (dev-route harness exists).
- Decision 5: ≤2% pixel delta for AA; strict for layout / element presence.

## Changed files expected

- `web/playwright.config.ts`
- `web/tests/visual/fixture.spec.ts`
- `web/tests/visual/screenshot-corpus.spec.ts`
- `web/tests/visual-baselines/mock/m*.png`
- `web/tests/visual-baselines/screenshot/*.png`
- `web/package.json` (add `test:visual` script)

## Steps

1. Install Playwright: `cd web && npm i -D @playwright/test && npx playwright install --with-deps chromium`.
2. Author `web/playwright.config.ts` with desktop / tablet / mobile viewport projects + Decision 5 tolerance settings.
3. Author `web/tests/visual/fixture.spec.ts` — for each implemented fixture in `IMPLEMENTED_FIXTURES`: navigate to `/mock?id=<fixture_id>`, take a screenshot, compare to `web/tests/visual-baselines/mock/<fixture_id>.png`.
4. Author `web/tests/visual/screenshot-corpus.spec.ts` — uses the dev-route harness from viz-07a; one snapshot per screenshot-manifest entry.
5. Add `npm run test:visual` script to `web/package.json`.
6. First run creates the baselines; commit them. Subsequent runs diff against them.
7. Wire into `verify:ui` only after baselines are reviewed.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:visual   # first run produces baselines
```

## Acceptance criteria

- All 21 fixture cards have approved baselines under `mock/`.
- All non-discard screenshots have approved baselines under `screenshot/`.
- Re-running `test:visual` on a clean checkout shows zero drift.
