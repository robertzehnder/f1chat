---
id: viz-09-card-shell-parity
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-09-card-shell-parity/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

The outer card shell — red dot + title + race subtitle + narrative + chart + KEY TAKEAWAYS + EXPLORE FURTHER chips — matches the screenshots within Decision-5 tolerance. Single source of truth: card-level CSS variables / tokens.

## Context

- Combined plan Phase 9 (last step; ships after everything else lands).
- Depends on viz-07b (baselines need to exist to verify changes).
- Style tokens flow from one shared shell component, not per-card overrides.

## Changed files expected

- `web/src/components/f1-chat/insight-card.tsx`
- `web/src/app/globals.css` (or `web/src/lib/card-tokens.ts`)
- `web/tests/visual-baselines/**/*.png` (likely re-approved after token changes)

## Steps

1. Locate the outer card component (likely `insight-card.tsx`).
2. Side-by-side with screenshot #1 (Suzuka esses): identify every styling delta:
   - Header red dot diameter / color
   - Title font weight + size
   - Race subtitle opacity + tracking
   - Divider line color + opacity
   - KEY TAKEAWAYS label letter-spacing + size
   - Dash-prefix color on takeaway bullets
   - EXPLORE FURTHER chip pill border / background / text color + padding
3. Update the shared shell. Single source: card-level CSS variables in `globals.css` OR a `card-tokens.ts` module.
4. Re-run viz-07b's parity harness; report should classify all 25 cards as `matches` or `minor drift` only.
5. Re-approve Playwright baselines that changed due to token updates.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run lint
cd web && npm run test:visual
```

## Acceptance criteria

- All 25 cards on `/_dev/screenshot-parity` are visually within 5% of their screenshots.
- No CSS overrides at the per-card level — shell styling flows from card-level tokens.
- Playwright baselines re-approved + checked in.
