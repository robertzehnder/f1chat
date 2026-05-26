---
id: viz-01-screenshot-manifest
phase: 22
status: pending
owner: claude
user_approval_required: no
proposal_branch: slice/viz-01-screenshot-manifest/proposal-1
updated: 2026-05-25T15:50:00-07:00
---

## Goal

Make `docs/f1-visualizations/` machine-readable. Every PNG mapped to a fixture, a visual_id, a prompt, a sample qid, and a status (`implemented` / `follow_up` / `discard`). Validator script confirms the manifest stays in sync with on-disk reality.

## Context

- Combined plan: [diagnostic/f1_visualizations_combined_plan_2026-05-25.md](../f1_visualizations_combined_plan_2026-05-25.md) Phase 1
- 25 PNGs in [docs/f1-visualizations/](../../docs/f1-visualizations/)
- Fixture inventory: [web/src/__mocks__/insights/manifest.ts](../../web/src/__mocks__/insights/manifest.ts) — IMPLEMENTED_FIXTURES has 21; M07 + M23 are follow-ups
- Decisions §0 of combined plan: M07 + M23 deferred (no current screenshot requires them)

## Changed files expected

- `docs/f1-visualizations/manifest.json`
- `diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md`
- `web/scripts/health/validate-screenshot-manifest.ts`

## Steps

1. Iterate every `.png` in `docs/f1-visualizations/`. For each: record dimensions via `node -e "..."` or a small Sharp call; flag anomalies (anything smaller than 200×200 likely an accidental crop).
2. For each PNG, transcribe the prompt text from the user message bubble + visible chart type.
3. Map each PNG to a fixture id from `IMPLEMENTED_FIXTURES`. If the prompt + chart type matches an implemented fixture, status=`implemented`. If it matches M07 (team-grouped bars w/ side strip) or M23 (track marker map), status=`follow_up` (none expected per §0). If the PNG is a crop / duplicate / unusable, status=`discard` with `reason`.
4. Write `docs/f1-visualizations/manifest.json` with one entry per file. Schema: `{ file, fixture_id?, visual_id?, prompt?, sample_qid?, variant?, status, reason?, notes? }`.
5. Write `diagnostic/f1_visualization_screenshot_inventory_2026-05-25.md` as the human-readable counterpart — a table that mirrors the JSON, plus a per-PNG one-line characterization.
6. Write `web/scripts/health/validate-screenshot-manifest.ts`:
   - Asserts every `.png` in the directory has a manifest entry.
   - Asserts every manifest entry's `file` exists on disk.
   - Asserts every `implemented` entry's `fixture_id` exists in `IMPLEMENTED_FIXTURES`.
   - Asserts every `discard` entry has a non-empty `reason`.
   - Exit code: 0 on success, non-zero with a clear message on failure.

## Gate commands

```bash
cd web && npm run typecheck
cd web && npx tsx scripts/health/validate-screenshot-manifest.ts
```

## Acceptance criteria

- 100% of 25 PNGs classified in the manifest.
- Zero anonymous screenshots; zero broken file references.
- All `implemented` entries map to a real fixture id from `IMPLEMENTED_FIXTURES`.
- Validator returns 0.
