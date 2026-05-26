---
id: viz-07a-parity-harness-dev-route
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-07a-parity-harness-dev-route/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

A dev-only `/_dev/screenshot-parity` page that renders every screenshot's ChartSpec stacked for visual diff against the source PNG corpus. Cheap interim parity check before Playwright lands.

## Context

- Combined plan Phase 7a
- Depends on viz-01 (manifest) + viz-02 (matrix) + viz-03 (typed specs).
- Production-gated: `process.env.NODE_ENV !== 'production'`.

## Changed files expected

- `web/src/app/_dev/screenshot-parity/page.tsx`
- `web/scripts/health/screenshot-specs.ts`
- `diagnostic/artifacts/screenshot-parity-2026-05-25/` (directory)
- `diagnostic/artifacts/screenshot-parity-2026-05-25.md`

## Steps

1. Create `web/src/app/_dev/screenshot-parity/page.tsx` — Next.js page gated by `NODE_ENV !== 'production'`. Returns 404 in production. Iterates over the spec list and renders each card with the screenshot filename above.
2. Create `web/scripts/health/screenshot-specs.ts` — exports one `ChartSpec` (or top-level `InsightCardProps`) literal per screenshot manifest entry. For implemented fixtures, derive from the fixture's mock object. For follow-ups / discards, skip.
3. Start the dev server (`npm run dev`); navigate to `/_dev/screenshot-parity`; capture each rendered card via Playwright headless mode → `diagnostic/artifacts/screenshot-parity-2026-05-25/<n>.png`.
4. Write `diagnostic/artifacts/screenshot-parity-2026-05-25.md` comparing each rendered card to the source: one of `matches | minor drift | major divergence | data-shape mismatch`.

## Gate commands

```bash
cd web && npm run typecheck
cd web && (npm run dev &) && sleep 8 && curl -fsS http://localhost:3000/_dev/screenshot-parity > /dev/null && pkill -f 'next dev'
```

## Acceptance criteria

- Dev page renders all 25 cards without runtime errors.
- Parity report classifies every card with a one-line description.
- Page returns 404 when `NODE_ENV=production` (manual check or build test).
