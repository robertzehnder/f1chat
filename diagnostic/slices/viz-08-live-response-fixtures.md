---
id: viz-08-live-response-fixtures
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-08-live-response-fixtures/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Real prompts produce the expected visuals. Captured `ChatApiResponse` per qid becomes a regression fixture so drift surfaces in CI.

## Context

- Combined plan Phase 8
- Depends on viz-05 (detectors confirmed against live SQL).
- Captures one response per implemented visual (21 total).

## Changed files expected

- `web/scripts/fixtures/visualization-responses/q*.json`
- `web/src/app/_dev/replay/page.tsx`
- `web/tests/visual/live.spec.ts`
- `web/tests/visual-baselines/live/q*.png`

## Steps

1. Pick one representative qid per implemented visual using `benchmarkQids` arrays in [manifest.ts](../../web/src/__mocks__/insights/manifest.ts).
2. For each qid: run the live chat through the API; capture the final `ChatApiResponse` JSON (rows, SQL, synthesis insight fields, resulting `DraftInsight`).
3. Sanitize — strip session-key noise, timestamps, anything non-deterministic. Leave the visual-relevant fields intact.
4. Store under `web/scripts/fixtures/visualization-responses/q<qid>.json`.
5. Add `web/src/app/_dev/replay/page.tsx` — reads a query param `?qid=<n>`, loads the matching JSON fixture, runs it through `mapInsight.ts`, renders the resulting card.
6. Author `web/tests/visual/live.spec.ts` — for each captured response, navigate to `/_dev/replay?qid=<qid>`, screenshot, compare to `web/tests/visual-baselines/live/q<qid>.png`.
7. Update `verify:ui` script to include the live spec.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:visual
```

## Acceptance criteria

- At least one captured response per implemented visual (21 total).
- All non-fallback live responses render to the expected visual type.
- Allowed fallbacks (per viz-05) are documented with reason.
