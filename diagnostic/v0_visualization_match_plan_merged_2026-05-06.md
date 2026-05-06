# V0 Visualization Match Plan — merged (2026-05-06)

**Goal**: every live `/api/chat` response renders a card that **visually
matches the corresponding `/mock` fixture**, with that match proven
testable, type-safe, and drift-resistant. The existing backend
(`web/src/app/api/**`, `web/src/lib/**` runtime libs, Neon access,
resolver, grading harness) is preserved unchanged except for explicit
adapter additions.

**Sources**: this plan merges
- [diagnostic/v0_visualization_parity_plan_2026-05-06.md](diagnostic/v0_visualization_parity_plan_2026-05-06.md) (synthesis-side: how the LLM emits structured fields)
- [diagnostic/v0_exact_visualization_match_plan_2026-05-06.md](diagnostic/v0_exact_visualization_match_plan_2026-05-06.md) (infrastructure-side: how exactness is verified)

The two plans solve different halves of the same problem; this merge
takes the load-bearing decisions from each.

---

## 1 · The combined diagnosis

The gap between live `/api/chat` and the `/mock` fixtures has **two
distinct causes** that compound:

1. **Data-shape gap (synthesis side)**: the LLM produces prose body +
   SQL only. The InsightCard has 8 slots (title, subtitle, body,
   metrics, chart, takeaways, related_questions, plus
   hero/verdict/composite for special types). 5 of those slots are
   empty in production because nothing populates them.

2. **Verifiability gap (infrastructure side)**: there's no way to
   prove "matches v0" today beyond eyeballing screenshots. The
   imported components are byte-identical but drift can creep in
   through `as any` casts, twin token modules, or chart-shape
   detectors that silently fall through. There are 11 chart
   renderers without auto-detectors and 2 chart families (M07, M23)
   without renderers at all.

Both gaps must close. Neither plan alone is sufficient: the
infrastructure half doesn't fill the empty slots, and the synthesis
half can't prove it stays exact over time.

---

## 2 · Architectural principles

Carried from both source plans, deduplicated:

1. **Backend preservation is non-negotiable.**
   `web/src/app/api/**` and runtime libs stay byte-identical except
   for explicit adapter additions enumerated in §10. The compatibility
   boundary is `/api/chat` SSE.

2. **V0 owns the frontend visual language.**
   Don't bend v0 globals back toward the old palette. Same components,
   same tokens, same dark theme.

3. **Use a typed boundary, not ad-hoc row sniffing.**
   Backend rows enter through `mapInsight.ts`; components consume
   `ChartSpec` / `InsightMock` / `DraftInsight` / `InsightCardProps`.
   No fixture or detector reaches into Recharts internals.

4. **Exactness needs visual regression, not just typecheck.**
   Recharts output and CSS spacing can be type-correct but visually
   wrong. `/mock` screenshots are a merge gate.

5. **Fixture parity, adapter parity, and live parity are three gates.**
   `/mock` proves the renderer surface. Adapter unit tests prove
   `ChatApiResponse` payloads route to the right renderer. Browser
   smoke proves the two are wired together.

6. **Synthesis structured output is the load-bearing change.**
   Without it, the visible card stays body+sql+rows even after every
   other piece of work lands. It must be the first IMPLEMENTATION
   phase after the source-of-truth declaration (i.e. Phase 2; Phase 1
   is a doc-only declaration that gates everything else).

7. **Fail to body-only, never blank.**
   Schema validation, malformed JSON, missing renderers — all
   degrade to today's body+sql+table render. No code path renders an
   empty or broken card.

---

## 3 · Per-mock fidelity matrix

✅ = present, ⚠ = partial, ❌ = missing.

| Mock | Chart type | Renderer | Auto-detect | Title | Metrics | Takeaways | Related Qs | Hero/Verdict |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| M01 hero | none | n/a | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ |
| M02 verdict | none | n/a | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ |
| M03 metric_grid | none | n/a | ⚠ | ⚠ | ❌ | ❌ | ❌ | – |
| M04 corner grouped | grouped_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M05 braking grouped | grouped_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M06 ranking | horizontal_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M07 team-grouped ranking | horizontal_bar_team_grouped | ❌ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M08 stint Gantt | stint_gantt | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M09 multi-line | line | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M10 line+stint | line_with_stint_markers | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M11 scatter+regression | scatter_with_regression | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M12 diverging | horizontal_bar_diverging | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M13 stacked | stacked_horizontal_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | – |
| M14 dual-axis | line_dual_axis | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M15 timeline | event_timeline | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M16 minisector | track_heatmap | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M17 radar | radar | ✅ | ❌ | ⚠ | – | ❌ | ❌ | – |
| M18 status grid | status_grid | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M19 donut | donut | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M20 composite | composite (nested) | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ⚠ |
| M21 refusal | none | n/a | ✅ | ✅ | – | – | ❌ | – |
| M22 pit cycle | pit_event_strip | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |
| M23 track marker map | track_marker_map | ❌ | ❌ | ⚠ | ❌ | ❌ | ❌ | – |

**Summary**: 21 of 23 renderers exist; **all 23 mocks need
metrics/takeaways/related_questions from the LLM**; 2 chart families
need new renderers (M07, M23 — gated on Phase 1's
`IN_SCOPE_MOCK_COUNT`).

**Detector coverage gap**:
- Tier 1 detectors built today: 6 (`grouped_bar`,
  `horizontal_bar_diverging`, `stacked_horizontal_bar`, `stint_gantt`,
  `line`, `horizontal_bar`)
- Tier 2/3 detectors needed (when count=23): **12 total** —
  `event_timeline`, `radar`, `scatter_with_regression`,
  `status_grid`, `donut`, `line_dual_axis`,
  `line_with_stint_markers`, `track_heatmap`, `pit_event_strip`,
  `composite`, `horizontal_bar_team_grouped` (M07),
  `track_marker_map` (M23)
- When count=21: **10** (drop M07 + M23 from the list above)

This is the single source of truth for the count. §4.3 table and
Phase 6 mirror it.

---

## 4 · Architectural considerations (the deep ones)

### 4.1 Synthesis output shape — three options, one recommendation

How the LLM emits structured fields alongside prose. Three candidates:

**Option A — JSON sidecar in the answer text, server-extracted** *(recommended)*

The LLM emits a sentinel-bracketed JSON block followed by prose. The
**server** is the only consumer of the sentinel format — it extracts
the JSON from the streaming buffer BEFORE forwarding any
`answer_delta`, so clients never see the JSON wire format:

```
<<INSIGHT>>
{ "title": "Clean Air vs Traffic — 2025 Season",
  "subtitle": "All Race Sessions · 2025",
  "metrics": [...], "key_takeaways": [...], "related_questions": [...] }
<<END>>
Across the 2025 season so far, Verstappen leads in clean-air share...
```

**Canonical wire contract** (binding for §4.8 and Phase 2):
- `synthesizeAnswerStream` parses the streaming buffer with a small
  state machine. While inside `<<INSIGHT>>...<<END>>`, no `answer_delta`
  is emitted to the client. When `<<END>>` is parsed, the server emits
  one `event: insight` SSE frame with the validated payload. After
  `<<END>>`, every subsequent token streams as `answer_delta` — pure
  prose, no JSON.
- `final.answer` in `ChatApiResponse` is the concatenated post-`<<END>>`
  prose. JSON sentinel and structured fields are NEVER in `answer`.
- `ChatApiResponse.insight: InsightFields | null` is additive — set
  server-side when extraction succeeds, `null` on parse failure.
- Old (non-SSE, JSON-only) clients see `answer` as prose and `insight`
  as a new optional field they ignore.
- The benchmark grader reads `answer` and gets identical prose to today.

- ✓ streaming intact, single-source-of-truth on the server, no client
  parser, no leak of sidecar into `answer_delta` or `final.answer`
- ✗ requires a small streaming state-machine on the server (~60 LoC);
  parse failures still need fallback (Phase 11)

**Option B — Tool-use call** (`render_insight` tool)
- ✓ Anthropic enforces schema; zero parse failures
- ✗ doubles latency (tool round-trip + prose); breaks streaming UX

**Option C — Anthropic structured outputs** (full schema-validated JSON)
- ✓ zero parse failures
- ✗ kills streaming entirely; user sees stalled UI

**Decision: Option A.** The streaming UX (synthesis_start stage event,
reasoning_delta panel, answer_delta body fill) is load-bearing for the
"feels alive" feel. Options B and C break it. Option A's parse
failures are mitigated by Phase 11 (schema validation + body-only
fallback) — no code path renders blank.

### 4.2 Per-question-type shape selection

Different mocks need different output shapes. Don't bloat the prompt
for simple cases. Two architectural choices:

1. **Classifier picks a shape** *(recommended)*: extend
   `chatRuntime.classifyQuestion()` to return an `InsightShape`
   (`hero` / `verdict` / `metric-grid` / `chart-with-metrics` /
   `composite` / `refusal`). Synthesis prompt picks 1 of 6
   shape-specific templates with appropriate few-shot examples.
2. **LLM picks a shape**: single prompt, model decides. Adds
   non-determinism, complicates the prompt, and the classifier
   already exists and is tested.

### 4.3 Chart-type auto-detection coverage

Even with structured output from the LLM, the LLM may not always
specify a chart shape (or hallucinate the wrong one). The client
needs robust auto-detection from row signatures as a safety net.

We have 6 detectors today (Tier 1). The remaining count is **12 when
`IN_SCOPE_MOCK_COUNT=23`** (i.e. M07 + M23 are in scope), or **10
when count=21** (the last two rows of the table below are skipped).
Each is a regex/column-set match → builder pair, ~20-35 LoC.

| # | Chart type | Row signature | Priority | Conditional |
|---:|---|---|---|---|
| 1 | `event_timeline` | `lap` + `kind` + `driver` | High (M15) | always |
| 2 | `radar` | per-axis numeric cols, ≤8 cols, 1-2 rows | High (M17) | always |
| 3 | `scatter_with_regression` | `stint_lap` + `lap_time`, multi-driver | Med (M11) | always |
| 4 | `status_grid` | `session_label` + `*_coverage` cols | Med (M18) | always |
| 5 | `donut` | `label` + `value`, single-pivot | Low (M19) | always |
| 6 | `line_dual_axis` | `lap` + `lap_time` + (`rainfall`\|`track_temp`) | Med (M14) | always |
| 7 | `line_with_stint_markers` | `lap` + `delta` + multi-stint | Low (M10) | always |
| 8 | `track_heatmap` | `minisector_index` + `name` + `leader` | Med (M16) | always |
| 9 | `pit_event_strip` | `phase_label` + `duration_sec` | Low (M22) | always |
| 10 | `composite` | per-question-type override (M20 only) | Low (M20) | always |
| 11 | `horizontal_bar_team_grouped` | driver+team+ranking metric | Med (M07) | count=23 only |
| 12 | `track_marker_map` | overtake-event coords or corner names | Low (M23) | count=23 only |

### 4.4 Detector registry vs monolithic `detectChart()`

The current `detectChart()` is a growing if/else chain. As we add 11
more detectors it will become unmaintainable. Replace with a registry:

```ts
type ChartDetector = {
  id: string;
  priority: number;
  matches(rows: Record<string, unknown>[], context: AdapterContext): boolean;
  build(rows: Record<string, unknown>[], context: AdapterContext): ChartSpec;
  fixtures: string[];      // /mock fixture ids that should resolve to this detector
  benchmarkQids: number[]; // qids that should route here
};
```

Architectural considerations:
- Detector priority ordering must prevent scalar hero answers from
  becoming one-bar charts
- Some detectors need question/category context, not just columns
  (e.g. distinguish radar vs grouped_bar when both have multi-numeric
  rows; the question's topic disambiguates)
- Detection must be deterministic for adapter tests
- Registry exposes coverage reports: chart types with fixtures but no
  live detector, and live detectors with no fixture

### 4.5 Discriminated `ChartSpec` union

Today's flat optional `ChartSpec` lets a `donut` fixture put `slices`
on a `grouped_bar` and still typecheck. The renderer index uses
`as any` casts in 5 places. Migrate to a discriminated union:

```ts
type ChartSpec =
  | GroupedBarSpec
  | HorizontalBarSpec
  | StackedHorizontalBarSpec
  | DivergingBarSpec
  | LineSpec
  | LineWithStintMarkersSpec
  | LineDualAxisSpec
  | ScatterRegressionSpec
  | StintGanttSpec
  | DonutSpec
  | PitEventStripSpec
  | RadarSpec
  | StatusGridSpec
  | EventTimelineSpec
  | TrackHeatmapSpec
  | TrackMarkerMapSpec
  | TeamGroupedHorizontalBarSpec;
```

This must happen AFTER all 17 renderers exist, otherwise the
intermediate state has invalid types.

### 4.6 Token budget + streaming overhead

Current synthesis prompt: ~2.5KB static prefix + ~1-3KB dynamic
suffix. Output: ~500-1500 tokens.

Adding the JSON sidecar:
- **Prompt addition**: ~500 tokens of schema + 1-2 examples per shape
- **Output addition**: ~200-400 tokens of structured fields
- **Per-request cost on Sonnet 4.6**: ~+$0.003/question
- **Over 167 benchmark questions**: +$0.50 per full run

Streaming impact: JSON sidecar lands BEFORE the body, so:
- First ~150-300 tokens of `answer_delta` are JSON (client buffers
  them silently, doesn't render until `<<END>>`)
- Activity log + reasoning_delta panel keep moving during the buffer
- Total perceived latency: same as today

### 4.7 Schema validation + fallback degradation

Three layers:
1. **Sentinel extraction**: pull text between `<<INSIGHT>>` and
   `<<END>>`; if no `<<END>>` in first ~3KB of output, treat whole
   response as body
2. **Hand-rolled validator** (no `zod` dep — `web/package.json` has no
   schema-validation library and adding one is out of scope). The
   validator is a single ~80-LoC function that walks the parsed JSON,
   coerces primitives, drops fields that fail type/shape checks, and
   logs `WARN` per drop. Structurally invalid JSON (parse throws)
   falls through entirely to body-only.
3. **Body-only fallback**: card renders today's body+sql+rows view
   when structured fields aren't available

Telemetry counter for `chat_insight_parse` outcomes
(success/partial/fallback/retry) feeds the decision of whether
Option A holds up or we migrate to B/C.

### 4.8 Backwards compatibility with the benchmark

Per the canonical contract in §4.1: extraction is server-side, so the
benchmark already gets prose-only `answer`. Specifically:

1. `run_category_benchmarks.mjs` posts to `/api/chat` without
   `Accept: text/event-stream`, so it gets the full `ChatApiResponse`
   as JSON. The `answer` field contains only post-`<<END>>` prose
   (the server has already stripped the sentinel block).
2. The new `ChatApiResponse.insight: InsightFields | null` field is
   additive — old clients (incl. the grader) ignore it; new clients
   consume it.
3. The benchmark grader reads `answer` and sees identical prose to
   today — no A-rate movement from this change alone (Phase 15 gate
   verifies).

### 4.9 Source-of-truth declaration

`_v0_drop/f1-chat-v0/` was deleted at the end of the migration. If
someone asks "match v0 exactly" tomorrow, what IS v0? Two paths:

1. **Restore** the original v0 export under `_v0_reference/` with a
   checksum manifest of files that should remain byte-equal to copies
   in `web/src/`
2. **Declare** the imported `web/src/components/f1-chat/**` +
   `web/src/__mocks__/insights/_source.ts` as canonical for this repo

Decision must be made before any "exact match" claim is testable.

### 4.10 Token / asset module consolidation

Two team-color modules currently exist:
- `web/src/lib/teamColors.ts`
- `web/src/lib/f1-team-colors.ts`

These will drift. Plus compound colors (hard/medium/soft/inter/wet)
are inlined in `mapInsight.ts` and could appear in any new chart
renderer. Consolidate to a single source-of-truth module:
`web/src/lib/visualTokens.ts` exporting team colors, compound colors,
chart-semantic colors, and refusal/muted treatment values.

### 4.11 Visual regression infrastructure

Playwright captures `/mock` and `/mock/live-fixtures` at three
viewports (1440×1200 desktop, 1280×900 laptop, 390×844 mobile).
Considerations:
- Recharts animations must be disabled / stabilized
- Fonts must load deterministically (Next font preloading)
- Dynamic gradient/clip-path IDs cause snapshot noise
- Dark theme must be forced consistently

This is the gate that makes "matches v0" a testable claim instead of
a visual opinion.

---

## 5 · Open questions (decide before execution)

1. **Source of truth**: restore original v0 export under
   `_v0_reference/`, or declare current imported state canonical?
   Codex flagged this and I assumed the latter without saying so.
2. **M07 + M23 in milestone or follow-up**: M23 alone is ~8-12 hours
   of SVG work. **Phase 1 MUST emit a binding decision here** — the
   source-of-truth doc records `IN_SCOPE_MOCK_COUNT` as either 21
   (M07/M23 deferred) or 23 (full coverage). Every downstream gate
   that mentions "all 23 fixtures" is read CONDITIONALLY against
   that constant — see §6 Phase 4 / §6 Phase 6 / §9 Done /
   §6 Phase 12 acceptance for the conditional language. The plan
   does not let Phase 4 ship M07/M23 partially; either both ship in
   Phase 4 (count=23) or both defer to a follow-up plan (count=21).
3. **Snapshot storage**: PNG diffs committed to repo, Playwright
   `.snap` files, or generated artifacts under `diagnostic/`?
4. **Chart selection driver**: row-shape only, or
   row-shape + question-classification? (Recommendation in §4.2 is
   classification-driven, which means SOME runtime field plumbing.)
5. **SQL/table/reasoning disclosure parity**: are these part of v0
   exactness, or accepted as repo-specific additions because the
   existing backend exposes them and v0 didn't?

These should be settled in the source-of-truth doc before Phase 1
starts.

---

## 6 · Phased execution plan (16 phases)

Ordered by dependency: foundational declarations first, then the
load-bearing synthesis change, then renderer/detector coverage, then
type safety, then verification infrastructure, then polish + CI gates.

### Phase 1 — Source-of-truth declaration

**Owns**: `diagnostic/v0_visual_source_of_truth.md` (new),
`web/src/__mocks__/insights/manifest.ts` (new).

**Delivers**:
- Decision document declaring whether `_v0_reference/` is restored or
  current imported state is canonical
- Typed fixture manifest with all 23 mock entries:
  `{ id, title, mockFile, sourceExport, chartType, renderer, status, benchmarkQids }`
- `/mock` route reads from manifest (cannot drift from declared
  inventory)

**Effort**: 2-3 hours.
**Acceptance**: open question 1 has a documented answer; manifest
includes M07 + M23 with `status: "follow_up"` until implemented.

### Phase 2 — Synthesis structured output (LOAD-BEARING)

**Owns**: `web/src/lib/synthesis/buildSynthesisPrompt.ts`,
`web/src/lib/anthropic.ts` (`synthesizeAnswerStream`),
`web/src/lib/chatTypes.ts` (`ChatApiResponse.insight`),
`web/src/lib/mapChatResponse.ts`,
`web/src/app/api/chat/orchestration.ts` (final-frame payload),
`web/src/lib/chat/consumeChatStream.ts` (new `onInsight` hook).

**Delivers** (per the canonical contract in §4.1):
- New `<<INSIGHT>>` ... `<<END>>` sentinel format in the synthesis
  prompt
- `synthesizeAnswerStream` runs a streaming state-machine that:
  - while inside `<<INSIGHT>>...<<END>>`, accumulates JSON characters
    and emits NO `answer_delta` to the client
  - on `<<END>>`, parses + validates the JSON; emits one
    `event: insight` SSE frame with `{ insight: InsightFields | null }`
  - after `<<END>>`, every subsequent token streams as `answer_delta`
    (pure prose)
- `ChatApiResponse.insight: InsightFields | null` populated
  server-side (the same value as the SSE `insight` event); `answer`
  contains ONLY post-`<<END>>` prose
- `consumeChatStream` gains `onInsight(fields)` hook for the new
  SSE event type; existing `onAnswerDelta` and `onReasoningDelta`
  unchanged
- `mapInsight.ts` `applyInsightFields(insight, fields)` merges
  structured fields into `DraftInsight` (preserves existing fields
  not overridden)
- Hand-rolled validator (no `zod` dep — see §4.7) — fields that fail
  validation are dropped with a `WARN` log; structurally invalid
  JSON falls through entirely to body-only render
- Adapter test fixtures for the 5 most common shapes (M01, M04, M06,
  M09, M21)

**Effort**: 6-8 hours (includes prompt engineering + 5 captured-fixture
test cases).
**Acceptance**: live chat for "Compare Verstappen vs Hamilton through
the Suzuka esses" renders title + subtitle + metrics + chart +
takeaways + related_questions, visually matching `/mock` M04.
Benchmark backwards-compat: `npm run test:grading` passes.

### Phase 3 — Per-question-type shape templates

**Owns**: `web/src/lib/chatRuntime/classification.ts`,
`web/src/lib/synthesis/buildSynthesisPrompt.ts` (6 shape-specific
templates).

**Delivers**:
- New `InsightShape` enum (`hero` / `verdict` / `metric-grid` /
  `chart-with-metrics` / `composite` / `refusal`) returned by an
  extension to `classifyQuestion`
- Synthesis prompt picks 1 of 6 templates with appropriate few-shot
  examples
- Hero questions emit `{ hero: ... }` and minimal body; refusal
  questions emit `{ tone: "muted", what_we_have: [...] }`; etc.

**Effort**: 4-5 hours (mostly few-shot example design — domain voice
takes iteration).
**Acceptance**: pole-lap → M01 hero card; refusal → M21 muted; corner
comparison → M04 grouped-bar with metrics + takeaways. Visual /mock
parity for the 6 shape archetypes.

### Phase 4 — M07 renderer + M23 renderer (renderer coverage) — *conditional on Phase 1*

**Conditional on**: `IN_SCOPE_MOCK_COUNT === 23` from Phase 1's
source-of-truth declaration. If Phase 1 set the count to 21, this
phase is SKIPPED entirely and the corresponding gates in Phases 6, 9,
12, and §9 Done read against count=21.

**Owns**: `web/src/components/f1-chat/charts/team-grouped-horizontal-bar-chart.tsx` (new),
`web/src/components/f1-chat/charts/track-marker-map.tsx` (new),
`web/src/components/f1-chat/charts/index.tsx`, fixture files.

**Delivers**:
- `TeamGroupedHorizontalBarChart`: extends M06 with a team-color
  side strip + teammate adjacency. Falls back to team-color inference
  by driver name when team metadata absent.
- `TrackMarkerMap`: SVG circuit outline + markers at overtake
  locations. First-pass: simplified outlines for top 6 venues (Spa,
  Monaco, Suzuka, Silverstone, Monza, Bahrain — covers ~50% of seed
  questions); generic-track fallback for the rest.
- `m07-team-grouped-ranking.ts` and `m23-track-marker-map.ts`
  fixtures; `/mock` extends from 21 to 23
- `ChartSpec` extended with `teams?: string[]` and
  `markers?: Array<{ lap?, corner?, x_track_pct?, y_track_pct?, label, color? }>`

**Effort** (when count=23): 8-12 hours (most of it M23 SVG sourcing).
**Effort** (when count=21): 0 hours — phase skipped.

**Acceptance**: `/mock` renders `IN_SCOPE_MOCK_COUNT` fixtures
cleanly. When count=23, both new renderers have test fixtures and
don't crash on missing coordinates or team metadata.

### Phase 5 — Detector registry (replaces `detectChart()`)

**Owns**: `web/src/lib/mapInsight/detectors/` (new directory),
`web/src/lib/mapInsight.ts`.

**Delivers**:
- `ChartDetector` interface
- `web/src/lib/mapInsight/detectors/registry.ts` exporting `detectChart`
  that runs ordered detectors
- 6 existing Tier-1 detectors migrated to registry entries (one file
  each under `detectors/`)
- Coverage report tool: lists chart types with no detector AND
  detectors with no fixture

**Effort**: 3-4 hours.
**Acceptance**: existing 6 Tier-1 detectors pass adapter tests;
registry pretty-prints coverage table.

### Phase 6 — Tier 2/3 detector coverage (10 or 12 detectors, conditional)

**Conditional on**: `IN_SCOPE_MOCK_COUNT` from Phase 1. Ships **12
detectors when count=23** (full coverage), or **10 detectors when
count=21** (M07 + M23 detectors deferred). The list of names below
is the complete count=23 set; drop the last two rows when count=21.

**Owns**: `web/src/lib/mapInsight/detectors/` (10 or 12 new files).

**Delivers** (count=23):
1. `event_timeline` (M15)
2. `radar` (M17)
3. `scatter_with_regression` (M11)
4. `status_grid` (M18)
5. `donut` (M19)
6. `line_dual_axis` (M14)
7. `line_with_stint_markers` (M10)
8. `track_heatmap` (M16)
9. `pit_event_strip` (M22)
10. `composite` (M20)
11. `horizontal_bar_team_grouped` (M07) *— count=23 only*
12. `track_marker_map` (M23) *— count=23 only*

Plus an adapter test per detector: one captured `ChatApiResponse`
fixture proving the row signature routes correctly.

**Effort** (count=23): 5-6 hours (~20-35 LoC per detector + test).
**Effort** (count=21): 4-5 hours (10 detectors).
**Acceptance**: registry coverage report shows zero "renderer without
detector" entries for the in-scope count. Adapter test count
matches the detector count.

### Phase 7 — Discriminated `ChartSpec` union

**Owns**: `web/src/lib/chart-types.ts`, all chart renderers,
`web/src/lib/mapInsight/detectors/*` builders.

**Delivers**:
- 17 narrow Spec interfaces (one per chart type) replacing the flat
  optional `ChartSpec`
- Renderer index switch narrows by `chart.type` discriminant; no
  more `as any` casts
- Detector `build()` functions return their specific Spec type
- Fixtures' chart fields fail typecheck if fields don't match the
  declared `type`

**Effort**: 4-5 hours.
**Acceptance**: `npm run typecheck` clean; `grep -rE "as any" web/src/components/f1-chat`
returns zero hits; an intentional bad fixture (test only) fails type
narrowing.

### Phase 8 — Adapter fixture capture from benchmark

**Owns**: `web/scripts/capture-adapter-fixtures.mjs` (new),
`web/scripts/tests/fixtures/chat-api/` (new directory of 167 captured
payloads), `diagnostic/v0_chart_mapping_report_YYYY-MM-DD.md` (new).

**Delivers**:
- Script that re-runs the benchmark suite and captures each
  `ChatApiResponse` to a per-qid fixture file
- Generated mapping report: `qid → category → expected_visual →
  detected_visual → detector_id → fallback_reason`
- Adapter test runs each captured fixture through
  `mapChatApiResponseToParts → foldPartsIntoInsight → semantic passes`
  and asserts the expected visual

**Effort**: 5-6 hours.
**Acceptance**: every A/B benchmark answer maps to one of: implemented
chart, hero/verdict/refusal, OR explicit body/table fallback with
documented reason. No silent "unknown chart type" for fixture-backed
chart types.

### Phase 9 — Per-qid expectation manifest

**Owns**: `diagnostic/v0_visualization_expectations.json` (new),
`web/scripts/tests/visualization-contract.test.ts` (new).

**Delivers**:
- Manifest entry per qid:
  `{ qid, expected_visual, required_fields, allowed_fallback }`
- Test that validates each captured fixture against its expectation
- Complements (does not replace) the grading rubric — tests
  presentation shape, not factual correctness

**Effort**: 3-4 hours.
**Acceptance**: a question that should be M08 cannot silently render
as a table-only card without `allowed_fallback: true` declared.

### Phase 10 — Token / color consolidation

**Owns**: `web/src/lib/visualTokens.ts` (new),
`web/src/lib/teamColors.ts` (delete or re-export),
`web/src/lib/f1-team-colors.ts` (delete or re-export).

**Delivers**:
- Single `visualTokens` module: `TEAM_COLORS`,
  `DRIVER_TEAM`, `COMPOUND_COLORS`, `CHART_SEMANTIC_COLORS`,
  `MUTED_TREATMENT`
- All chart renderers + builders import from here
- Old modules either deleted (if no external imports) or thin
  re-export shims for one release cycle

**Effort**: 2-3 hours.
**Acceptance**: `grep -rE "f1-team-colors|teamColors" web/src/lib/visualTokens.ts`
shows the consolidation; `grep -rE "from.*teamColors" web/src` shows
all imports go through one module.

### Phase 11 — Reliability + retry + telemetry

**Owns**: `web/src/lib/synthesis/*`, `web/src/lib/anthropic.ts`.
(Phase 11 only USES `web/src/lib/perfTrace.ts`'s existing
`appendQueryTrace` / span-recording API; it does not modify the
module itself, so `perfTrace.ts` stays byte-identical and is NOT
in the allow-list.)

**Delivers**:
- Single retry on JSON parse failure (re-prompt with stricter
  instruction); fall through to body-only after 1 retry
- New `chat_insight_parse` perf trace span recorded via the existing
  `perfTrace` API: outcome `success | partial | fallback | retry`
- Telemetry counter for parse-failure rate (queryable from existing
  trace JSONL log; no new sink)

**Effort**: 3-4 hours.
**Acceptance**: synthetic malformed responses (truncated JSON, missing
fields, wrong types) all fall back to body-only render without
runtime errors. Telemetry shows <5% parse-failure rate on 167
benchmark questions.

### Phase 12 — Visual regression for `/mock`

**Owns**: `web/tests/visual/mock-fixtures.spec.ts` (new),
`web/playwright.config.ts` (new), Playwright snapshots committed.

**Delivers**:
- Playwright captures all `IN_SCOPE_MOCK_COUNT` fixtures (21 or 23
  per Phase 1) at 3 viewports (1440×1200, 1280×900, 390×844)
- Recharts animations disabled; deterministic font loading; forced
  dark theme; stable `data-testid` per fixture
- `npm run test:visual:mocks` script
- First-pass pixel threshold loose, ratchets down over time

**Effort**: 5-7 hours.
**Acceptance**: every `/mock` fixture in the manifest has a stable
baseline; running `test:visual:mocks` passes deterministically.

### Phase 13 — Visual regression for live pipeline

**Owns**: `web/src/app/mock/live-fixtures/page.tsx` (new),
`web/tests/visual/live-fixtures.spec.ts` (new).

**Delivers**:
- `/mock/live-fixtures` route renders captured `ChatApiResponse`
  payloads through the real pipeline:
  `mapChatApiResponseToParts → foldPartsIntoInsight → applyResponseSemantics →
   applyScalarHero → applyVerdictSemantics → applyQuestionTitle →
   applyInsightFields → toCardProps → InsightCard`
- Playwright captures one screenshot per chart type from the live
  pipeline
- Snapshot labels include qid + detector id

**Effort**: 4-5 hours.
**Acceptance**: visual snapshots prove the live pipeline matches the
fixture pipeline for every implemented chart type.

### Phase 14 — Responsive + interaction sweep

**Owns**: every chart renderer; `web/src/components/f1-chat/*`.

**Delivers**:
- Mobile (390px) audit: minimum readable height, axis tick overlap,
  legend wrapping, horizontal scroll where needed, touch-tooltip
  usability
- Interaction audit: sidebar collapse, suggested chips, follow-up
  chips, SQL disclosure, reasoning disclosure, activity-log
  live/complete states, empty/loading/error states
- Browser smoke test: one happy path, one refusal, one SQL error /
  empty table, one streaming response

**Effort**: 4-5 hours.
**Acceptance**: mobile screenshots for all 23 mocks pass; no chart
overflows the card container at 390px; keyboard focus order usable
for input + chips + disclosures + sidebar.

### Phase 15 — Backend benchmark parity gate

**Owns**: `web/scripts/run_category_benchmarks.mjs` (run, not edit),
`diagnostic/phase_19_baseline_*.json` (new baseline file).

**Delivers**:
- Full 167-question benchmark run on the merged code
- Baseline file written for diff comparison against May-5 baseline
  (104/167 A)
- Confirmation that no backend regression slipped in via the lib
  changes (`mapInsight.ts`, `synthesis/`, etc.)

**Effort**: 1-2 hours (mostly waiting for run + diff review).
**Acceptance**: A-rate ≥ 104/167. If lower, identify which lib
change caused the regression and fix before merging.

### Phase 16 — CI gates (`npm run verify:ui`)

**Owns**: `web/package.json`, CI configuration.

**Delivers**:
```json
{
  "test:visual:mocks": "playwright test tests/visual/mock-fixtures.spec.ts",
  "test:visual:live": "playwright test tests/visual/live-fixtures.spec.ts",
  "test:visualization-contract": "tsx --test scripts/tests/visualization-contract.test.ts",
  "verify:ui": "npm run typecheck && npm run test:adapter && npm run test:visualization-contract && npm run test:visual:mocks && npm run test:visual:live"
}
```

**Effort**: 1-2 hours.
**Acceptance**: `verify:ui` passes locally and in CI.

---

## 7 · Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM hallucinates JSON structure (missing braces, mis-escaped quotes) | Medium | High | Phase 11 schema validation + body-only fallback. Single retry. Telemetry counter feeds Option B/C decision if rate >10%. |
| Token budget overflow on synthesis prompt | Low | Medium | Few-shot examples are per-shape (not all-shapes); shape classifier picks 1 of 6 templates |
| `cachedSynthesize` cache invalidation: same question, different cache key under new prompt | High | Low | Bump prompt-version constant; cache rebuilds naturally |
| Streaming UX feels stalled while JSON sidecar buffers | Medium | Medium | Activity log + reasoning_delta keep moving during the buffer; net effect: no perceptible change |
| Benchmark A-rate drops because takeaways change `answer` text | Low | High | Body field is split CLEANLY from JSON sidecar at `<<END>>`; grader sees identical body prose |
| 11 new auto-detectors over-fire on questions they shouldn't catch | Medium | Medium | Tight column-signature regex; false positives surface in `/mock` review and adapter tests |
| M23 SVG circuit outlines are tedious to source | High | Low | Start with 6 venues + generic fallback; expand incrementally |
| Phase 11 retry path doubles latency on flaky responses | Low | Medium | Single retry; budget logged; fallback after retry returns body-only |
| Recharts screenshots are flaky | Medium | Medium | Disable animations, wait for fonts/layout, deterministic dimensions |
| Discriminated `ChartSpec` migration breaks existing fixtures | Medium | Medium | Phase 7 happens after Phase 4 (M07/M23 renderers exist) and Phase 6 (all detectors built); fixtures + builders + renderers all migrate together |
| Backend changes sneak into UI PR | High | Medium | Phase 15 backend benchmark parity gate; explicit allow-list of touched lib files in commit messages |
| "Exact match" undefined because original v0 export is gone | High | High | Phase 1 source-of-truth declaration is mandatory before any "exact" claim |
| Visual snapshots slow CI too much | Medium | Medium | `verify:ui` runs visual suite as a PR gate; lighter `verify` (typecheck + adapter + grading) on every local commit |

---

## 8 · Out of scope

- **Streaming-first JSON parsing**: rendering structured fields
  chunk-by-chunk as the JSON streams. Currently we wait for `<<END>>`
  to fire all fields at once. Streaming partial JSON is fragile and
  high-effort for marginal UX gain.
- **Conversation history**: sidebar's "0 conversations" stub is
  empty; localStorage-backed history is a separate feature.
- **Light mode**: v0 ships dark-only; we keep dark.
- **Adversarial input**: prompt injection mitigation (e.g. user puts
  `<<END>>` in their question) is a separate threat model — handled
  via stripping sentinel tokens from user input before prompt
  assembly.
- **M07/M23 marked follow-up**: if the source-of-truth answer in
  Phase 1 says these can stay deferred, Phases 4 (their part) and
  the related fixtures/detectors slip to a follow-up plan.

---

## 9 · Done = these all hold

- [ ] Phase 1 source-of-truth doc exists; declares canonical baseline;
      manifest covers 23 mocks
- [ ] Live `/api/chat` for representative questions per shape
      (M01-M06, M08-M22) produces a card visually matching the
      corresponding `/mock` fixture (≥90% pixel similar at 1440×1200)
- [ ] `npm run test:adapter` covers all 17 chart shapes plus
      hero/verdict/refusal — at least 1 captured `ChatApiResponse`
      fixture per shape
- [ ] `npm run test:visualization-contract` validates the per-qid
      expectation manifest against captured fixtures
- [ ] `npm run test:visual:mocks` green — all `IN_SCOPE_MOCK_COUNT`
      fixtures (21 or 23 per Phase 1) have stable baselines at 3
      viewports
- [ ] `npm run test:visual:live` green — live pipeline produces
      visuals matching fixtures for every implemented chart type
- [ ] `npm run test:grading` clean (no regression on body-only
      grader baseline)
- [ ] Backend benchmark A-rate ≥ 104/167 (May-5 parity)
- [ ] Telemetry: <5% insight-parse-failure rate over 50-question
      sample
- [ ] No production card EVER renders blank — fallback path covers
      all known failure modes
- [ ] `grep -rE "as any" web/src/components/f1-chat` returns zero hits
- [ ] Single team-color module; old modules deleted or re-export shims

---

## 10 · Allow-list of touched lib files

Backend lib files are byte-identical EXCEPT for these explicit
adapter/UI additions:

**New files**:
- `web/src/lib/visualTokens.ts`
- `web/src/lib/mapInsight/detectors/` (registry + 17 detector files)
- `web/src/__mocks__/insights/manifest.ts`

**Existing files modified**:
- `web/src/lib/chart-types.ts` (discriminated union)
- `web/src/lib/mapInsight.ts` (registry refactor + `applyInsightFields`)
- `web/src/lib/toCardProps.ts` (insight fields passthrough)
- `web/src/lib/chatTypes.ts` (`ChatApiResponse.insight` field added —
  additive)
- `web/src/lib/mapChatResponse.ts` (forward `insight` field if present)
- `web/src/lib/chat/consumeChatStream.ts` (`onInsight` hook)
- `web/src/lib/synthesis/buildSynthesisPrompt.ts` (sentinel format,
  6 shape templates)
- `web/src/lib/anthropic.ts` (`synthesizeAnswerStream` JSON extraction)
- `web/src/lib/chatRuntime/classification.ts` (new `InsightShape` enum)
- `web/src/app/api/chat/orchestration.ts` (final-frame `insight` field
  + new `event: insight` SSE frame)

**Files that must stay byte-identical**: `web/src/lib/db.ts`,
`web/src/lib/queries/**`, `web/src/lib/chatRuntime.ts` (except
classification extension above), `web/src/lib/validators/**`,
`web/src/lib/answerSanity*`, `web/src/lib/contracts/**`,
`web/src/lib/runtimeModels/**`, every existing `web/src/app/api/**`
route handler.

**CI gate** (covers BOTH `web/src/lib` AND
`web/src/app/api/chat/orchestration.ts`):

```sh
# Lib allow-list
git diff --stat main..HEAD -- web/src/lib | \
  grep -vE "(visualTokens|mapInsight|toCardProps|chartTypes|chart-types|mapChatResponse|chat/consumeChatStream|synthesis/buildSynthesisPrompt|anthropic|chatRuntime/classification)" | \
  grep -E "^\s+\S" && exit 1

# API allow-list — the only API file allowed to change is chat/orchestration.ts
git diff --stat main..HEAD -- web/src/app/api | \
  grep -vE "chat/orchestration\.ts" | \
  grep -E "^\s+\S" && exit 1

echo ok
```

The lib allow-list is intentionally comprehensive: every modified
file in §10 is covered. The API allow-list is intentionally tight:
ONLY `chat/orchestration.ts` may change in `web/src/app/api/`.
`perfTrace.ts` is NOT in the lib allow-list because no phase
modifies it (Phase 11 only USES its existing API).

---

## 11 · Effort estimate

| Phase | Hours | Cumulative |
|---|---:|---:|
| 1 — Source-of-truth + manifest | 2-3 | 3 |
| 2 — Synthesis structured output (LOAD-BEARING) | 6-8 | 11 |
| 3 — Per-shape prompt templates | 4-5 | 16 |
| 4 — M07 + M23 renderers | 8-12 | 28 |
| 5 — Detector registry | 3-4 | 32 |
| 6 — Tier 2/3 detectors (10 of them) | 4-5 | 37 |
| 7 — Discriminated `ChartSpec` union | 4-5 | 42 |
| 8 — Adapter fixture capture from benchmark | 5-6 | 48 |
| 9 — Per-qid expectation manifest | 3-4 | 52 |
| 10 — Token / color consolidation | 2-3 | 55 |
| 11 — Reliability + retry + telemetry | 3-4 | 59 |
| 12 — Visual regression for `/mock` | 5-7 | 66 |
| 13 — Visual regression for live pipeline | 4-5 | 71 |
| 14 — Responsive + interaction sweep | 4-5 | 76 |
| 15 — Benchmark parity gate | 1-2 | 78 |
| 16 — CI gates | 1-2 | 80 |

**Total: 60-80 hours of focused work.**

---

## 12 · Reference

- [diagnostic/v0_ui_migration_plan_2026-05-06.md](diagnostic/v0_ui_migration_plan_2026-05-06.md) — the migration that imported v0
- [diagnostic/phase26_v0_visualization_brief_2026-05-05.md](diagnostic/phase26_v0_visualization_brief_2026-05-05.md) — the 23-mock visualization contract
- [diagnostic/phase26_analysis_categories_plan_2026-05-05.md](diagnostic/phase26_analysis_categories_plan_2026-05-05.md) — the 14 data categories backing the mocks
- [diagnostic/v0_visualization_parity_plan_2026-05-06.md](diagnostic/v0_visualization_parity_plan_2026-05-06.md) — synthesis-side parity plan (subset of this merged plan)
- [diagnostic/v0_exact_visualization_match_plan_2026-05-06.md](diagnostic/v0_exact_visualization_match_plan_2026-05-06.md) — infrastructure-side exact-match plan (subset of this merged plan)

**File**: [diagnostic/v0_visualization_match_plan_merged_2026-05-06.md](diagnostic/v0_visualization_match_plan_merged_2026-05-06.md)
