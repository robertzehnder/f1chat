# V0 Visualization Parity Plan — make live chat match every fixture

**Goal**: every question that hits `/api/chat` produces an InsightCard
that visually matches what the corresponding `/mock` fixture would
render. Today the live response fills 3 slots (body, sql, rows); the
fixtures fill 8 (title, subtitle, body, metrics, chart, takeaways,
related_questions, plus hero/verdict/composite for special types). The
remaining 5 slots render as empty space in production.

**Scope**: 21 in-scope mock types (M01–M22, excluding M07 + M23 which
need new renderers — handled in Phase 5).

---

## 1 · The fundamental gap (one paragraph)

The v0 components and Tailwind tokens are byte-identical to the
imported export. The `/mock` route renders fixtures with all fields
populated and the page looks great. The live chat renders the same
components but with most fields empty, because the synthesis LLM only
produces prose body text + SQL. **The gap is data-shape, not styling.**
Closing it requires changing the contract between the synthesis
pipeline and the UI: the LLM has to emit structured fields alongside
the prose, and those fields have to flow through SSE → adapter → card
without breaking the existing benchmark.

---

## 2 · Per-mock fidelity matrix

What each mock NEEDS vs what production emits TODAY. ✅ = present, ⚠ = partial, ❌ = missing.

| Mock | Chart type | Renderer | Auto-detect | Title | Metrics | Takeaways | Related Qs | Body | Hero/Verdict |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| M01 hero | none | n/a | ✅ | ⚠ (question-derived) | ❌ | ❌ | ❌ | ✅ | ✅ |
| M02 verdict | none | n/a | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | ✅ |
| M03 metric_grid | none | n/a | ⚠ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M04 corner grouped | grouped_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M05 braking grouped | grouped_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M06 ranking | horizontal_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M08 stint Gantt | stint_gantt | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M09 multi-line | line | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M10 line+stint | line_with_stint_markers | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M11 scatter+regression | scatter_with_regression | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M12 diverging | horizontal_bar_diverging | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M13 stacked | stacked_horizontal_bar | ✅ | ✅ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M14 dual-axis | line_dual_axis | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M15 timeline | event_timeline | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M16 minisector | track_heatmap | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M17 radar | radar | ✅ | ❌ | ⚠ | – | ❌ | ❌ | ✅ | – |
| M18 status grid | status_grid | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M19 donut | donut | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |
| M20 composite | composite (nested) | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | ⚠ |
| M21 refusal | none | n/a | ✅ | ✅ | – | – | ❌ | ✅ | – |
| M22 pit cycle | pit_event_strip | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ | ✅ | – |

**Coverage summary**:
- All 21 renderers exist (zero rendering-side work)
- 11 chart types still need auto-detectors
- 21 of 21 mocks have ❌ on metrics, takeaways, related_questions —
  these need to come from the synthesis LLM, not row inspection

---

## 3 · Architectural considerations (the hard parts)

### 3.1 Synthesis output shape — three options

**The decision**: how does the LLM emit structured fields alongside
prose? Three candidate designs, each with sharp tradeoffs.

#### Option A — JSON sidecar in the answer text

LLM emits a sentinel-bracketed JSON block followed by prose:

```
<<INSIGHT>>
{
  "title": "Clean Air vs Traffic — 2025 Season",
  "subtitle": "All Race Sessions · 2025",
  "metrics": [{"label":"Most Clean-Air laps","value":"412","unit":"VER"}],
  "key_takeaways": ["..."],
  "related_questions": ["..."]
}
<<END>>
Across the 2025 season so far, Verstappen leads in clean-air share...
```

Client splits on `<<END>>`, parses the JSON, treats the rest as body.
Streams over `answer_delta` events normally.

- **Pros**: zero changes to streaming infrastructure; minimal
  prompt-budget overhead; works with the existing `synthesizeAnswerStream`
  iterator; the answer field stays prose for the benchmark grader.
- **Cons**: parse failures on malformed JSON (model occasionally
  hallucinates the closing brace, mis-escapes quotes); needs a
  validation + fallback path; the JSON streams char-by-char so the user
  briefly sees raw `{"title":...` before `<<END>>` arrives.

#### Option B — Tool-use call ("render_insight")

LLM is given a `render_insight` tool with a JSON schema. The model
calls the tool with structured fields, THEN writes prose body in a
follow-up turn.

- **Pros**: Anthropic enforces the schema — zero parse failures by
  construction; the contract is a typed function signature, not a
  prompt convention; clean separation between data and prose.
- **Cons**: requires a second LLM round-trip (tool call → tool result
  → prose), nearly doubling latency; the streaming path becomes more
  complex (which round-trip is streaming what?); may break the
  existing `cachedSynthesize` cache key.

#### Option C — Anthropic structured outputs

Newest API feature — provide a JSON schema in the request, get a
guaranteed-valid JSON response.

- **Pros**: schema-validated by API, zero parse failures.
- **Cons**: incompatible with streaming text deltas; the existing
  `answer_delta` / `reasoning_delta` UX would have to be rebuilt; no
  partial output until the entire JSON is finalized — feels stalled.

#### Recommendation: **Option A (JSON sidecar)**

The streaming UX is load-bearing for the "feels alive" feel we just
shipped. Option B doubles latency and breaks `synthesizeAnswerStream`.
Option C kills streaming entirely. Option A keeps the streaming path
intact and adds ~150-300 tokens of structured prelude before the body
streams. Parse failures are mitigated by **schema validation +
fallback** (Phase 4); when the JSON is unparseable, we fall back to
the body-only render we ship today, so the failure mode is "looks the
same as before" — never broken UI.

### 3.2 Per-question-type shape selection

Different mocks need different output shapes. M01 (hero) wants
`{ hero: { value, label } }` and NO chart. M21 (refusal) wants
`{ tone: "muted", what_we_have: [...] }` and NO chart. M20
(cross-category) wants nested `composite` blocks. The synthesis prompt
can't be one-size-fits-all without bloating the output for simple
questions.

**Two architectural choices**:

1. **Classifier picks a shape** — the existing `chatRuntime.classifyQuestion()`
   already produces a `QuestionType` (`aggregate_analysis`,
   `comparison_analysis`, etc.). Extend it to a finer-grained
   `InsightShape` (`hero` / `verdict` / `metric-grid` / `chart-with-
   metrics` / `composite` / `refusal`) and pass that into the
   synthesis prompt.
2. **LLM picks a shape** — single prompt that tells the LLM to choose
   the right shape based on the question and rows. Ask for a
   `shape: "hero" | "chart" | ...` field at the top of the JSON.

Recommendation: **(1) Classifier-driven shape**. The classifier already
exists and is tested; LLM-side shape selection adds non-determinism
and complicates the prompt. The classifier extension is ~80 lines of
heuristics matching the patterns we already have.

### 3.3 Chart-type auto-detection coverage

Even with structured output from the LLM, the LLM may not always
specify a chart shape (or may hallucinate the wrong one). The client
needs robust auto-detection from row signatures as a safety net.

We have 6 detectors today (Tier 1). The remaining 11 need to be
written. Each is a regex/column-set match → `build*` builder pair, ~20
LoC each. Order of priority by question frequency in the seed:

| Tier | Detector | Row signature | Builder LoC | Priority |
|---|---|---|:---:|---|
| 2 | `event_timeline` | `lap` + `kind` + `driver` | 25 | High (M15 incidents) |
| 2 | `radar` | per-axis numeric cols, ≤8 cols, 1-2 rows | 30 | High (M17 driver_score) |
| 2 | `scatter_with_regression` | `stint_lap` + `lap_time`, multi-driver | 35 | Medium (M11 tyre deg) |
| 2 | `status_grid` | `session_label` + `*_coverage` cols | 25 | Medium (M18 data health) |
| 2 | `donut` | `label` + `value`, single-row pivot | 20 | Low (M19 DRS) |
| 3 | `line_dual_axis` | `lap` + `lap_time` + (`rainfall` \| `track_temp`) | 30 | Medium (M14 weather) |
| 3 | `line_with_stint_markers` | `lap` + `delta` + multi-stint pattern | 35 | Low (M10) |
| 3 | `track_heatmap` | `minisector_index` + `name` + `leader` | 35 | Medium (M16 dominance) |
| 3 | `pit_event_strip` | `phase_label` + `duration_sec` | 25 | Low (M22) |
| 3 | `composite` | per-question-type override (M20 only) | 50 | Low (M20) |

Total: ~310 LoC for full coverage. Buildable in 2-3 commits.

### 3.4 Token budget + streaming overhead

The current synthesis prompt is ~2.5KB static prefix + ~1-3KB dynamic
suffix (FactContract + rows). Output is ~500-1500 tokens.

Adding the JSON sidecar:
- **Prompt addition**: ~500 tokens of schema + 1-2 examples (per shape)
- **Output addition**: ~200-400 tokens of structured fields

Per-request cost on Sonnet 4.6: roughly +$0.003 per question. Over
167 benchmark questions, +$0.50 per full run. Acceptable.

Streaming impact: the JSON sidecar lands BEFORE the body, so:
- First ~150-300 tokens of `answer_delta` are JSON
- Client buffers until `<<END>>` arrives, then displays parsed
  structured fields + starts streaming body to the InsightCard's body
- User sees the activity log + reasoning panel during the JSON phase,
  then body streams in below
- Total perceived latency: same as today (the JSON arrives in <1s
  typically; the body takes 5-15s to stream)

### 3.5 Schema validation + fallback degradation

The JSON sidecar will sometimes be malformed. The system must NEVER
break — only gracefully degrade. Three layers:

1. **Schema validation** (Zod or hand-rolled): parse the extracted
   JSON; if fields are missing or wrong-typed, log + skip them.
2. **Brace-balanced extraction**: extract everything between
   `<<INSIGHT>>` and `<<END>>` AND the body separately; if no
   `<<END>>` found in the first ~3KB of output, treat the whole
   response as body (no structured fields).
3. **Fallback render**: if structured parsing fails entirely, the card
   renders today's body+sql+rows view — the no-regression baseline.

The grade against `chatRuntime.adequacyGrade` continues to be measured
on the prose body, so a JSON failure doesn't tank benchmark A-rate.

### 3.6 Backwards compatibility with the benchmark

The `run_category_benchmarks.mjs` runner posts to `/api/chat` and
grades the `answer` field. Two requirements:

1. The `answer` field in the final SSE frame's `ChatApiResponse` must
   continue to contain ONLY the prose body, NOT the JSON sidecar.
   The split happens server-side in the synthesis pipeline.
2. The benchmark already runs without `Accept: text/event-stream`, so
   it gets a JSON response. The structured fields can be added to a
   new `insight: {...}` field on `ChatApiResponse` (separate from
   `answer`) so old clients ignore them and new clients consume them.

### 3.7 Per-mock domain knowledge

The takeaways and metric tiles need DOMAIN-CORRECT phrasing. v0's
fixtures show what "good" looks like:

> Verstappen led 82% of his laps in clean air
> Avg traffic pace penalty: +0.42 s/lap field-wide
> 5 drivers maintained 70%+ clean-air share
> Backmarkers spent >55% of laps stuck behind another car

These bullets COMBINE row data with F1 domain insight. The synthesis
prompt needs example-shots — 2-3 worked examples per question shape —
to teach the model the voice + structure. **Few-shot prompt design is
the make-or-break work** for this phase.

---

## 4 · Phased implementation plan

### Phase 1 — Synthesis structured output (load-bearing)

**Owns**: `web/src/lib/synthesis/buildSynthesisPrompt.ts`,
`web/src/lib/anthropic.ts` (`synthesizeAnswerStream`),
`web/src/lib/chatTypes.ts` (`ChatApiResponse.insight`),
`web/src/lib/mapChatResponse.ts`, `web/src/lib/mapInsight.ts`,
`web/src/app/api/chat/orchestration.ts` (final-frame payload).

**Delivers**:
- New `<<INSIGHT>>` … `<<END>>` sentinel format in the synthesis
  prompt; LLM emits JSON THEN prose body
- `synthesizeAnswerStream` extracts the JSON section before the first
  `answer_delta` (uses a small parser-state machine on the streaming
  buffer); emits a new `event: insight` SSE frame with the parsed
  fields
- `ChatApiResponse.insight: InsightFields` populated server-side so
  the non-SSE benchmark path also gets structured output
- `consumeChatStream` gains an `onInsight(fields)` hook
- `mapInsight.ts` `applyInsightFields(insight, fields)` merges the
  structured fields into the `DraftInsight` (preserves existing fields
  not overridden)
- Schema validation: malformed JSON falls through to body-only render
- Adapter test fixtures for the 5 most common shapes

**Estimated effort**: 6-8 hours including prompt engineering + 5
captured-fixture test cases.

**Acceptance**:
- Live chat for "Compare Verstappen vs Hamilton through the Suzuka
  esses" renders with title, subtitle, 3 metric tiles, grouped bar
  chart, 4 key takeaways, 3 related_questions — visually matching
  `/mock` route's M04 fixture
- Benchmark backwards-compat: `npm run test:grading` still passes
- Adapter tests: 5 captured ChatApiResponse fixtures with insight
  field populated parse + render correctly

### Phase 2 — Chart auto-detect coverage (Tier 2 + 3)

**Owns**: `web/src/lib/mapInsight.ts` (`detectChart` + new builders).

**Delivers**:
- 5 Tier-2 detectors: `event_timeline`, `radar`,
  `scatter_with_regression`, `status_grid`, `donut`
- 5 Tier-3 detectors: `line_dual_axis`, `line_with_stint_markers`,
  `track_heatmap`, `pit_event_strip`, `composite`
- Adapter tests for each new detector (one captured fixture per shape)

**Estimated effort**: 3-4 hours (each detector is ~20-35 LoC).

**Acceptance**: a fixture per chart shape produces the expected
`chart.type` after running through `foldPartsIntoInsight`.

### Phase 3 — Per-question-type shape prompts

**Owns**: `web/src/lib/chatRuntime/classification.ts`,
`web/src/lib/synthesis/buildSynthesisPrompt.ts`.

**Delivers**:
- New `InsightShape` enum (`hero` / `verdict` / `metric-grid` /
  `chart-with-metrics` / `composite` / `refusal`) returned by an
  extension to `classifyQuestion`
- The synthesis prompt picks one of 6 shape-specific templates with
  appropriate few-shot examples
- Hero questions emit `{ hero: ... }` and minimal body; refusal
  questions emit `{ tone: "muted", what_we_have: [...] }`; etc.

**Estimated effort**: 4-5 hours including 6 few-shot example sets.

**Acceptance**: Pole-lap questions render as M01 hero card; refusal
questions render as M21 muted card; comparison questions render as
M04 grouped-bar with metrics + takeaways. Visual /mock parity for
the 6 shape archetypes.

### Phase 4 — Reliability + retry + observability

**Owns**: `web/src/lib/synthesis/*`, `web/src/lib/anthropic.ts`,
`web/src/lib/perfTrace.ts`.

**Delivers**:
- Zod schema for `InsightFields`; validation runs server-side after
  JSON extraction; invalid fields are dropped with a `WARN` log
- Single retry on hard parse failure (re-prompt with stricter
  instruction); after 1 retry, fall through to body-only
- New `chat_insight_parse` perf trace span: success/fallback/retry
- Telemetry counter for parse-failure rate (will inform whether
  Option A holds up or we need to migrate to Option B/C)

**Estimated effort**: 3-4 hours.

**Acceptance**: synthetic malformed responses (truncated JSON, missing
fields, wrong types) all fall back to body-only render without
runtime errors. Telemetry shows <5% parse-failure rate on the 167
benchmark questions.

### Phase 5 — M07 + M23 renderers

**Owns**: `web/src/components/f1-chat/charts/index.tsx`, two new
chart renderer files.

**Delivers**:
- `horizontal_bar_team_grouped` renderer (M07): like M06 but with a
  team-color side strip grouping teammates visually
- `track_marker_map` renderer (M23): SVG circuit outline (one per
  venue, ~24 SVGs) with markers at overtake locations
- Fixture files `m07-team-grouped-ranking.ts` and
  `m23-track-marker-map.ts`
- `/mock` route extends from 21 to 23 fixtures
- Auto-detector for both shapes

**Estimated effort**: 8-12 hours — most of it in sourcing/drawing the
24 venue SVG outlines for M23. M07 is closer to 1-2 hours.

**Acceptance**: `/mock` route renders all 23 fixtures cleanly. Live
chat questions about straight-line speed (M07) and overtake locations
(M23) auto-detect to these shapes.

---

## 5 · Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM hallucinates JSON structure (missing closing brace, mis-escaped quotes) | Medium | High | Phase 4 schema validation + body-only fallback. Single-retry path. Structured outputs (Option C) is the escape hatch if parse-failure rate >10% |
| Token budget overflow on the synthesis prompt | Low | Medium | Few-shot examples are per-shape (not all-shapes); shape classifier picks 1 of 6 templates |
| `cachedSynthesize` cache invalidation: same question, different cache key under new prompt | High | Low | Bump prompt-version constant; cache rebuilds naturally |
| Streaming UX feels stalled while JSON sidecar buffers | Medium | Medium | Activity log keeps moving (synthesis_start fires when stream begins regardless of what bytes arrive); reasoning_delta still streams during JSON phase. Net effect: no perceptible change |
| Benchmark A-rate drops because takeaways change `answer` text | Low | High | Body field is split CLEANLY from the JSON sidecar at the `<<END>>` marker; benchmark grader sees identical body prose to today |
| 11 new auto-detectors over-fire on questions they shouldn't catch | Medium | Medium | Each detector is gated on a tight column-signature regex; false positives surface in `/mock` review and adapter tests |
| M23 SVG circuit outlines are tedious to source | High | Low | Start with 6 venues (Spa, Monaco, Suzuka, Silverstone, Monza, Bahrain — covers ~50% of seed questions); generic-track fallback for the rest until M23 fixtures expand |
| Phase 4 retry path doubles latency on flaky responses | Low | Medium | Single retry only; retry-budget logged; fallback after retry returns body-only (still useful) |

---

## 6 · Out of scope for this plan

- **Streaming-first JSON parsing**: rendering the chart and metric
  tiles as the JSON streams in chunk-by-chunk. Currently we wait for
  `<<END>>` to fire all structured fields at once. Streaming partial
  JSON would let metrics tiles populate one-at-a-time but is fragile
  and high-effort for marginal UX gain.
- **Conversation history**: the sidebar's "0 conversations" stub is
  empty; localStorage-backed history is a separate feature.
- **Light mode**: v0 ships dark-only and we keep dark.
- **Adversarial input**: this plan assumes well-meaning users. Prompt
  injection mitigation (e.g. user puts `<<END>>` in their question)
  is a separate threat model — handled via stripping sentinel tokens
  from user input before the prompt assembly.

---

## 7 · Estimated total effort

| Phase | Work | Hours |
|---|---|---:|
| 1 | Synthesis structured output | 6-8 |
| 2 | Chart auto-detect coverage (10 detectors) | 3-4 |
| 3 | Per-shape prompts (6 templates + few-shots) | 4-5 |
| 4 | Reliability + retry + telemetry | 3-4 |
| 5 | M07 + M23 renderers (most of M23 is SVGs) | 8-12 |
| **Total** | | **24-33** |

---

## 8 · Acceptance gate (when "match exactly" is true)

The plan is done when all of these hold:

- [ ] Each of the 21 in-scope mocks has a representative live-chat
      question that produces a card visually equivalent to the
      `/mock` fixture (compare side-by-side; ≥90% pixel-similar in
      header / body / chart / metrics / takeaways / chips).
- [ ] `npm run test:adapter` covers all 17 chart shapes plus hero,
      verdict, and refusal — at least 1 captured `ChatApiResponse`
      fixture per shape.
- [ ] `npm run test:grading` passes (no regression on the body-only
      baseline grader).
- [ ] Backend benchmark A-rate ≥ 104/167 (parity with May-5 baseline).
- [ ] `/mock` renders 23 fixtures (21 + M07 + M23) cleanly.
- [ ] Telemetry shows insight-parse-failure rate <5% over a 50-question
      sample.
- [ ] No production card EVER renders blank — fallback path covers
      all known failure modes.

---

## 9 · Reference: existing companion plans

- [diagnostic/v0_ui_migration_plan_2026-05-06.md](diagnostic/v0_ui_migration_plan_2026-05-06.md) — the migration that imported v0
- [diagnostic/phase26_v0_visualization_brief_2026-05-05.md](diagnostic/phase26_v0_visualization_brief_2026-05-05.md) — the 23-mock contract this plan delivers
- [diagnostic/phase26_analysis_categories_plan_2026-05-05.md](diagnostic/phase26_analysis_categories_plan_2026-05-05.md) — the 14-category data view

**File**: [diagnostic/v0_visualization_parity_plan_2026-05-06.md](diagnostic/v0_visualization_parity_plan_2026-05-06.md)
