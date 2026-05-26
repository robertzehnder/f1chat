---
id: viz-05-detector-tolerance-pass
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-05-detector-tolerance-pass/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Every benchmark qid that should produce a chart actually triggers the correct detector against live SQL output. False matches strengthened or downgraded.

## Context

- Combined plan Phase 5
- Source: [diagnostic/v0_visualization_expectations.json](../v0_visualization_expectations.json) — each qid declares `expected_visual`.
- Depends on viz-04 (contracts establish the row shape baseline).

## Changed files expected

- `web/src/lib/mapInsight/detectors/registry.ts`
- `diagnostic/v0_visualization_expectations.json` (annotate allowed fallbacks)
- `web/scripts/tests/detector-coverage.test.ts` (new)

## Steps

1. Read `v0_visualization_expectations.json` — enumerate qid → `expected_visual` pairs.
2. For each qid:
   - If `(fixture-only)` per viz-04: skip.
   - Otherwise: run the qid's SQL against live DB.
   - Run `runDetectorRegistry()` on the rows; record returned `detectorId`.
   - Assert `detectorId` matches `expected_visual`.
3. For mismatches, propose one of:
   - Extend the detector's `matches()` regex set.
   - Raise/lower the detector's priority.
   - Document an explicit `allowed_fallback` in the expectations JSON.
4. Strengthen known weak detectors:
   - `divergingBarDetector` vs `horizontalBarDetector` — only fire for explicit `position_delta` columns.
   - `lineDetector` vs `lineWithStintMarkersDetector` — verify the existing guard.
   - `statusGridDetector` — verify it only fires on actual coverage data.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npm run test:adapter
```

## Acceptance criteria

- Every qid with a non-fallback `expected_visual` triggers the matching detector.
- No detector has a known false positive against the qid corpus.
- New `detector-coverage.test.ts` exists and passes.
