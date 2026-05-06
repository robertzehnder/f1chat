# V0 Visual Source of Truth — Phase 1 deliverable

**Purpose**: settle the five open questions from
[diagnostic/v0_visualization_match_plan_merged_2026-05-06.md §5](v0_visualization_match_plan_merged_2026-05-06.md)
so Phase 2 (synthesis structured output) can start without ambiguity.

**Status**: signed-off baseline. Downstream phases read from this
document. Changes here require corresponding edits to the merged
plan + manifest.

---

## Decision 1 — Canonical v0 baseline

**Question**: restore the original v0 export under `_v0_reference/`,
or declare the current imported state canonical?

**Decision**: **Declare the current imported state canonical.**

Rationale:
- The original `_v0_drop/f1-chat-v0/` zip was deleted at the end of
  the migration (`chore: remove _v0_drop/ source` in
  `ui/v0-frontend-replacement` branch).
- The imported files in `web/src/components/f1-chat/**`,
  `web/src/components/ui/**`, and the split fixtures in
  `web/src/__mocks__/insights/_source.ts` are byte-equal to what we
  received — verified at migration time by the no-op `diff` between
  zip extraction and copy.
- Restoring the zip would be busywork: it's already represented by
  the imported files, plus the `_source.ts` monolith preserves the
  fixtures verbatim with only the import path rewritten
  (`./chart-types` → `@/lib/chart-types`).
- "Exact match" against the imported state is testable via the
  visual regression infrastructure in Phases 12-13.

**Canonical files** (the v0 visual baseline this plan matches against):
- `web/src/components/f1-chat/**` — chat shell + chart renderers
- `web/src/components/ui/**` — 6 selectively-copied shadcn primitives
- `web/src/lib/chart-types.ts` — `InsightMock` + `ChartSpec` + new
  `DraftInsight` + new discriminated specs (Phase 7)
- `web/src/lib/f1-team-colors.ts` — team palette + driver-team map
- `web/src/lib/f1-formatters.ts` — display helpers
- `web/src/lib/utils.ts` — `cn()` helper
- `web/src/__mocks__/insights/_source.ts` — v0 fixture monolith
  (read-only; per-file fixtures wrap it)
- `web/src/app/globals.css` + `web/tailwind.config.ts` — visual tokens

If a future change touches any canonical file, document the deviation
in the relevant phase commit.

---

## Decision 2 — IN_SCOPE_MOCK_COUNT

**Question**: ship M07 (team-grouped ranking) and M23 (track marker
map) in this milestone, or defer to a follow-up?

**Decision**: **`IN_SCOPE_MOCK_COUNT = 21`.** M07 and M23 are
deferred to a follow-up plan.

```
IN_SCOPE_MOCK_COUNT = 21
```

Rationale:
- M23 alone is ~8-12 hours of SVG circuit-outline work across ~24
  venues — that's product/asset work, not adapter or rendering work
- The seed contains only ~3 questions that would route to M23 and ~3
  to M07 (per the visualization brief's qid-to-mock lookup table) —
  ~3% of the 167 benchmark questions
- The other 21 mocks cover ~95% of question shapes; shipping them
  with full LLM-driven structured output (Phases 2-11) and visual
  regression infrastructure (Phases 12-16) delivers higher
  user-visible value than two more renderers
- A follow-up plan can ship M07 + M23 + their detectors + their SVG
  assets as a contained delta when the foundational work proves out

**Phase impact** (per the conditional language in the merged plan):
- Phase 4 (M07 + M23 renderers) — **SKIPPED**
- Phase 6 (chart detectors) — ships **10 detectors**, not 12
- Phase 7 (discriminated `ChartSpec` union) — ships **17 specs**,
  not 19
- Phase 12 + 13 (visual regression) — capture **21 fixtures**, not 23
- §9 Done checklist — reads against count=21 throughout

**Follow-up plan when M07/M23 land**: bump `IN_SCOPE_MOCK_COUNT` to 23,
flip M07/M23 manifest entries from `follow_up` to `implemented`, run
the conditional phases (4, 6 detector additions, 7 spec additions, 12
fixtures, 13 live fixtures) on the 2 new shapes only.

---

## Decision 3 — Snapshot storage format

**Question**: PNG diffs committed, Playwright `.snap` files, or
generated artifacts under `diagnostic/`?

**Decision**: **Playwright `.snap` files committed to the repo.**

Rationale:
- Standard Playwright pattern (`expect(page).toHaveScreenshot()`);
  no custom infrastructure
- CI-friendly: snapshot diffs render inline in the Playwright HTML
  report on PR review
- Storage footprint: ~50KB per PNG × 21 fixtures × 3 viewports = ~3MB
  total — acceptable
- Live-fixture snapshots (Phase 13) live alongside the mock snapshots
  in the same `__screenshots__/` directories per spec file

**Storage path**:
- `web/tests/visual/mock-fixtures.spec.ts-snapshots/`
- `web/tests/visual/live-fixtures.spec.ts-snapshots/`

Both committed to the repo. CI failure prints the diff inline.

---

## Decision 4 — Chart selection driver

**Question**: row-shape only, question-classification only, or both?

**Decision**: **Row-shape primary, question-classification as
context modifier.**

Rationale:
- Row-shape (column signature) is the deterministic primary signal:
  if rows have `corner_label + entry_speed_kph + driver_name`, the
  chart is `grouped_bar` regardless of how the question was phrased
- Question-classification breaks ties when the row signature is
  ambiguous: e.g. `radar` vs `grouped_bar` both have multi-numeric
  per-driver rows; the question's topic (driver_score axis-rating
  question) disambiguates to radar
- Phase 3 extends `classifyQuestion` to return `InsightShape` —
  Phase 5/6 detectors take an `AdapterContext` parameter that
  includes the shape, used only as a tiebreaker
- Hero (M01) and verdict (M02) are NOT row-driven — they're driven
  by question classification (`InsightShape: "hero" | "verdict"`)
  because their row shapes overlap with other shapes

**Implementation contract**:
```ts
interface AdapterContext {
  insightShape?: InsightShape;     // from Phase 3 classifier
  generationSource?: string;       // from response.generationSource
  // Future fields can be added without breaking detectors that
  // ignore them.
}

interface ChartDetector {
  matches(rows: Row[], ctx: AdapterContext): boolean;
  // Higher priority wins when multiple match.
  priority: number;
}
```

---

## Decision 5 — SQL / reasoning disclosure parity

**Question**: are the collapsible SQL block and reasoning `<details>`
disclosure considered part of v0 exactness, or accepted as
repo-specific additions?

**Decision**: **Repo-specific additions, not part of v0 exactness.**

Rationale:
- v0 was a frontend-only design without a real backend; it had no SQL
  or reasoning streams to surface
- This repo's `/api/chat` produces both via the existing
  orchestration; rendering them is genuinely useful (transparent
  about what the model did, debuggable)
- These render as small disclosures (`<details>` / `<summary>`) that
  don't visually compete with the v0 card content
- They're additive, not modifications to v0's visual language

**Implication for visual regression** (Phase 12): the `/mock` route
fixtures don't have `sql` or `rows` fields populated — the SQL +
table sections will be visually absent in mock snapshots. The
live-fixture snapshots (Phase 13) WILL have them. This is expected;
each phase has its own snapshot baseline.

---

## Cross-references

- Merged plan: [diagnostic/v0_visualization_match_plan_merged_2026-05-06.md](v0_visualization_match_plan_merged_2026-05-06.md)
- Visualization brief (23-mock contract): [diagnostic/phase26_v0_visualization_brief_2026-05-05.md](phase26_v0_visualization_brief_2026-05-05.md)
- v0 migration: [diagnostic/v0_ui_migration_plan_2026-05-06.md](v0_ui_migration_plan_2026-05-06.md)

---

## Sign-off

Decisions captured here gate Phase 2 onward. Any phase that depends on
`IN_SCOPE_MOCK_COUNT` reads it as **21** until this document changes.
