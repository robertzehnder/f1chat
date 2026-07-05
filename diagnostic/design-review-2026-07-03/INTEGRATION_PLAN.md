# F1 Insights — vNext visual integration plan (feasibility + sequence)
_2026-07-03 · converged with /2ndopinion (GPT-5.5, xhigh)_

## ⏱ EXECUTION LOG (live)
- **✅ Slice 0 — Token layer** (`globals.css`, `tailwind.config.ts`): near-black cool-neutral surfaces
  (hue 285→240, bg #0e0e0f, card #1a1a1c), dual red (`--primary` #E10600 accents + `--red-text` #ef3340
  small text, contrast-verified), `--accent-amber`, `--surface-raised`, `--chart-grid`, `--chart-axis`,
  `--section-label`, `--syntax-keyword`, `--semantic-positive/negative/warning`, motion tokens +
  `livePulse` keyframe + `prefers-reduced-motion` guard. Live-verified on `/mock`, no console errors.
- **✅ Slice 1 — Shell PR** (`insight-card.tsx` + contract): mono eyebrows (Geist Mono section-labels),
  glowing brand-red header dot (live-pulse when streaming), **`at_a_glance` promoted slot**, swept inline
  `#E10600` → tokens, accessible red bullets. `at_a_glance` threaded through `InsightFields` /
  `InsightMock` / `DraftInsight` / `toCardProps` / `applyInsightFields` / Anthropic validator / synthesis
  prompt (LLM path live-wired). 4 fixtures seeded. Live-verified (computed styles + screenshots).
- **✅ Color sweep** (9 components): activity-log, line-dual-axis (12 hex→tokens), line-chart, timeline,
  no-data, verdict, diverging-bar, race-trace → theme/semantic tokens; domain team/compound hex untouched.
- **✅ Slice: metric-grid tiles** — deck-signature **mono numbers** (tabular-nums), surface-raised tiles,
  token emphasis. Live-verified (318/92/226 km/h card).
- **✅ /2ndopinion checkpoint (foundation)** → REVISE, all fixes applied: SVG marker labels →`--red-text`,
  black pit-dot outlines fixed, `at_a_glance` LLM path wired. Typecheck green.
- **⏳ NEXT**: per-card chart restyles (grouped-bar axis, horizontal-bar, line, radar, scatter, stacked,
  stint-gantt, pit-event-strip, degradation, donut, status-grid, minisector, track-*, position-changes);
  deterministic `synthesis/*Insight.ts` `at_a_glance` emit; Bucket C data/detector changes.


**Question this answers:** can we port the Claude Design deck (`Latest All F1 Insights Corner Speed
Card/`) cleanly into the app "as the new mocks"?

## Verdict: FEASIBLE — no architectural blocker; work splits into 4 precise buckets

The architecture is unusually well-suited to this port. There is **no separate "mock" surface to
rebuild** — `/mock` and live chat render through the *same* `toCardProps → InsightCard → ChartRenderer`
path, so a component restyle updates both at once. The deck is a **visual spec** (Claude Design
`.dc.html` + generated `support.js` runtime, inline hex, mock data) — we rebuild in React against it, we
do NOT paste it. No architectural blocker found. The honest scoping is an inventory, not a single number:

### Renderer & fixture inventory (the real buckets)
`ChartType` has **24** members; `/mock` renders **21 implemented fixtures** (+2 `follow_up`), covering
**15 chart types + 5 card slots** (hero, verdict, metric_grid, composite, no_data).

- **Bucket A — restyle-only, has fixture (clean):** grouped_bar, horizontal_bar,
  horizontal_bar_diverging, line, line_dual_axis (wet_crossover), line_with_stint_markers (stint_delta +
  pace_cliff), stacked_horizontal_bar, radar, scatter_with_regression, status_grid, stint_gantt, donut,
  pit_event_strip, track_heatmap, timeline + the 5 slots. Restyle the component; the fixture already
  exercises it on `/mock`.
- **Bucket B — routes live but NO real fixture (restyle + author a fixture):** race_trace,
  degradation_curve, position_changes, track_speed_map, track_corner_delta, telemetry_overlay,
  event_timeline. Detectors exist ([registry.ts](web/src/lib/mapInsight/detectors/registry.ts)); to show
  the new design on `/mock` as the baseline, add a fixture per type. (Not a blocker — data shape already
  exists live.) **Metadata bug to fix as part of this:** M15 is labeled `event_timeline` /
  `renderer: TimelineChart` and its detector claims `fixtures: ["m15"]`
  ([manifest.ts:208](web/src/__mocks__/insights/manifest.ts), [registry.ts:599](web/src/lib/mapInsight/detectors/registry.ts)),
  but the actual m15 fixture is `type: "timeline"` ([_source.ts:198](web/src/__mocks__/insights/_source.ts))
  — so `event_timeline` has no true fixture. Either retype M15 to `event_timeline` or correct the metadata.
- **Bucket C — data/detector/contract change first (data-gated):** corner-delta generic routing (#1/#17),
  telemetry Maggotts segment-pin (#20), composite spin-pin (#6), no-data structured fields (#7),
  clarification actions (#8), and the new `at_a_glance` element.
- **Bucket D — dead renderers, decide wire-or-delete:** `delta_comparison` (explicitly not emitted,
  [index.tsx:41](web/src/components/f1-chat/charts/index.tsx)) and bare `timeline` (mock-only; live uses
  `event_timeline`). `metric_grid` is **slot-rendered** via `MetricGridRenderer`, not the `switch`;
  `event_timeline` **shares** `TimelineChart` with `timeline` — so it is NOT strictly
  one-component-per-type.
  - **NOT dead — correction:** `donut` DOES route live — `donutDetector` builds `type: "donut"` and is
    registered in `CHART_DETECTORS` ([registry.ts:854/879/1633](web/src/lib/mapInsight/detectors/registry.ts)),
    and live rows run the registry ([mapInsight.ts:262](web/src/lib/mapInsight.ts)). It sits in Bucket A
    (2 fixtures). The earlier "prose-only" observation was a **prompt/row-shape miss** (the tested
    categorical-share query didn't match the donut detector), not a dead renderer. Real work: ensure the
    categorical-share shape reliably routes (possibly a deterministic template), not "wire the renderer."

---

## Why a clean port is feasible (grounded in the repo)

1. **Unified render path.** `src/app/mock/page.tsx` maps fixtures through `toCardProps()` →
   `<InsightCard>` → `<ChartRenderer>` — the identical components the live SSE chat path uses
   (`toCardProps` adapts both `InsightMock` and `DraftInsight`). Restyle a component once; the mock
   baseline and production both change. "New mocks" is therefore **restyle shared components + extend
   fixture data**, not a parallel UI.
2. **The card shell already IS the deck's anatomy.** `insight-card.tsx` order is header → activity/
   reasoning → hero/verdict → body → no-data → metrics → chart → takeaways → SQL → result table. The
   deck's changes are restyle-level: collapse reasoning by default, promote an "answer at a glance"
   line, token swaps, mono-forward type.
3. **Stable typed contract.** `ChartType` (24), `ChartSpec`, `ChartSeries` (incl. the added
   `strokeDasharray/strokeWidth/opacity/emphasis`), `Metric`, `InsightMock` in `chart-types.ts`. The 21
   implemented fixtures carry the exact shape the live path emits for their types; the deck's cards
   render from this data. (Caveat: Bucket B types have the live shape but no fixture yet — see inventory.)
4. **Token layer is centralized.** `globals.css` dark-only HSL vars + `tailwind.config.ts` — so the
   *theme* is one place. The *sweep* of inline colors is larger than the 3 shell reds though: an audit
   (below) finds hardcoded theme colors across ~10 answer-card components. Domain team/compound hex is
   NOT part of the sweep (it stays raw by rule).
5. **Near component-per-type isolation.** ~28 components in `charts/`, mostly one per type via a single
   `switch` — low blast radius, easy visual diffing. Exceptions to handle explicitly (Bucket D):
   `metric_grid` is slot-rendered, `timeline`/`event_timeline` share `TimelineChart`, `delta_comparison`
   is dead.

---

## What is NOT a clean restyle (the honest caveats)

These need a **data/detector/contract change before** the card can be ported end-to-end:

| Item | Why | Size |
|---|---|---|
| `at_a_glance` element | Deck promotes a **bold, one-line answer ABOVE the tiles**; today the only near-match is `body`, a plain narrative paragraph ([insight-card.tsx:136](web/src/components/f1-chat/insight-card.tsx), renders *before* metrics), and `verdict.summary` which lives only inside the verdict card — **no reusable promoted field exists**. New optional field must thread through the FULL producer chain: `InsightFields` ([chatTypes.ts:89](web/src/lib/chatTypes.ts)) → `InsightMock`/`DraftInsight` ([chart-types.ts:186](web/src/lib/chart-types.ts)) → `toCardProps` → `applyInsightFields` ([mapInsight.ts:69](web/src/lib/mapInsight.ts)) → **both producer paths**: (a) the LLM path — synthesis prompt schema ([buildSynthesisPrompt.ts:59](web/src/lib/synthesis/buildSynthesisPrompt.ts)) + Anthropic validator ([anthropic.ts:879](web/src/lib/anthropic.ts)); AND (b) the **deterministic path** — the `synthesis/*Insight.ts` builders (race-trace, speed-map, etc.) that `orchestration.ts` assigns as `deterministicInsight.insight` ([orchestration.ts:1607–1655](web/src/app/api/chat/orchestration.ts)), which **bypass** the LLM schema+validator entirely. Each builder must emit `at_a_glance` or a shared fallback derive it (e.g. from `verdict.summary`/first takeaway) → shell slot. | Contract chain (med — two producer paths) |
| corner-delta routing (#1/#17) | Generic 2-driver×N-corner speed rows route to `grouped_bar`; the track corner-delta only renders on the brake-zone shape (`corner_label`+`apex_min_speed_kph`+`zone_f0/f1`). Needs a new deterministic template + detector. | Template + detector (med) |
| telemetry Maggotts segment-pin (#20) | Pinning "+11 kph at Maggotts" to a track *segment* is a richer spatial shape than `/api/track-outline` returns. Needs a runtime data contract (segment coords + delta). | Data contract (med) |
| composite spin-pin (#6) | Pinning a spin needs real corner/lap-fraction data for that incident (often absent). | Data-gated (small) |
| no-data structured fields (#7) | Richer "what the dataset holds" card may need structured fields beyond `body`/`what_we_have`. | Contract (small) |
| clarification actions (#8) | One-tap resolve is choice/resolution UI+API behavior, not a chart restyle. | UI/API (small) |

**Restyle-only** = Bucket A (has fixture) + Bucket B (routes live, needs a fixture authored). Both
consume the existing `ChartSeries` unchanged; the only difference is B needs a `/mock` fixture added so
the new design is visible as the baseline. See the Renderer & fixture inventory above for the exact
membership. Data-gated cards are Bucket C; dead renderers are Bucket D.

---

## Token layer (do FIRST — one PR, gated)

Two-layer rule holds: **semantic UI tokens** (globals.css) vs **domain colors** (raw hex in
`f1-team-colors.ts`, never tokenized). Reconciliation decisions:

- **Background** `285 5% 13%` (#211f22) → **near-black `#0e0e0f`**; **card** `285 5% 17%` → `#1a1a1c`.
- **Red is TWO tokens (contrast).** `#E10600` on `#0e0e0f` = **3.88:1, fails AA for normal text.** Keep
  `--primary #E10600` for brand accents / large numbers / borders / the live dot / buttons; add
  **`--red-text` (`#ef3340`, 4.79:1)** for any small red foreground (inline driver highlights, alerts).
- **Fonts:** keep **Geist / Geist Mono** — the design is "mono-*forward*," which Geist Mono delivers;
  treat a JetBrains switch as an explicit design decision, not an implementation swap (less churn).
- **Add:** `--surface-raised`, `--accent-amber (#f5b301)`, `--syntax-keyword (#c77dff)` (the SQL purple —
  not a team color), `--section-label`, motion tokens (`--dur-fast/med`, easing).
- **Motion:** the `livePulse` live dot + all skeleton/motion gated by `prefers-reduced-motion`.
- **Audited token sweep (not "3 reds" — ~10 answer-card components carry hardcoded theme colors):**
  `insight-card.tsx` (×3 `#E10600`), `activity-log.tsx`, `metric-grid.tsx`, `timeline-chart.tsx`,
  `line-chart.tsx` (markers), `line-dual-axis-chart.tsx` (**12 hardcoded** grays/blues/reds — worst
  offender), `line-with-stint-markers.tsx`, `stacked-horizontal-bar.tsx`, `race-trace-chart.tsx`,
  `track-map.tsx` (neutral/gradient), `track-speed-map.tsx`, `verdict-card.tsx`, `no-data-card.tsx`,
  `diverging-bar-chart.tsx`. **Distinguish** theme colors (→ tokens) from domain team/compound hex
  (→ stays raw). Grid/axis/neutral SVG constants that read like theme must become `--chart-grid` etc.,
  or the near-black bg change silently misses them.

---

## Sequence — vertical slices, detector/data changes LEAD each slice

Do NOT batch-port React around un-routable shapes. Per GPT-5.5: build the shape, then the card.

0. **Token + shell PR.** globals.css + tailwind.config.ts + f1-team-colors.ts consolidation + the shell
   restyle (collapse reasoning, `at_a_glance` slot, sweep inline red). Scoped to answer cards.
   - **The shell change is big-bang (touches every card).** Mitigate: land the token layer first as its
     own commit (pure values, no structure), screenshot-regress all fixtures, THEN the shell structure.
     Consider a `vnext` class/flag on `InsightCard` so old and new coexist during the slice rollout.
   - **`/mock` does NOT exercise live-only states** — fixtures leave `sql/rows/reasoning/streaming/
     activity` undefined; the live SSE path seeds and mutates them
     ([page.tsx:123/237/280](web/src/app/page.tsx)) and `InsightCard` has dedicated activity/reasoning/
     "Working…" branches ([insight-card.tsx:107](web/src/components/f1-chat/insight-card.tsx)). **Add
     fixtures (or a Storybook-style state matrix) for: streaming, activity-log live, reasoning
     disclosure, SQL block, result table, truncated** — and gate them visually before the shell merges,
     or the restyle silently regresses states `/mock` never shows.
1. **Slice = one card family.** For each, in order:
   a. If it needs a data/detector change (table above), land that first (template + detector +
      contract test that the detector emits the shape).
   b. Restyle/port the React component against **real `ChartSeries`** (keep dash/opacity/emphasis as
      data fields, never inline SVG attrs) + honesty components (reasoning state, `aria-expanded`, SQL
      disclosure, result table). Track-maps via runtime `/api/track-outline`.
   c. Update/extend the fixture (`__mocks__/insights/mNN-*.ts`) so `/mock` shows the new design as the
      baseline.
   d. Verify live + gate (below).
2. **Order of families:** restyle-only cards first (fast wins, exercise the token layer): hero → bars →
   lines → radar/scatter/donut → status_grid → track_speed_map/heatmap → race_trace/position_changes.
   Then the data-gated: corner-delta → telemetry segment-pin → composite → no-data → clarification.

## Gates (every slice)
- Visual diff vs the deck screenshot (`shots/` + the 8:35pm captures).
- Contrast/axe on near-black (esp. red text uses `--red-text`, not `--primary`).
- Mobile screenshot (~380px reflow).
- `prefers-reduced-motion` check.
- Contract tests: detector emits the expected column shape; `ChartSeries` optional fields survive.
- Randomized live sweep still A-grade (existing harness).

## Risks + mitigations
- **Global theme ripple** (near-black + dual-red touches every component) → token PR first, full
  screenshot regression before porting cards.
- **Un-routable polish** (building a card whose shape can't reach the pipeline) → detector/data change
  leads each slice; contract test gates it.
- **Honesty-UI regression** (porting visuals only) → the shell PR keeps reasoning/SQL/table/no-data/
  clarification as real behavior; gate with the existing tests.
- **Domain-color drift** → keep team/compound as raw hex in `f1-team-colors.ts`; do not alias to Tailwind.

## Effort (rough)
- Token + shell PR: ~1 slice of work.
- 18 restyle-only cards: small each (component-local), batch by family.
- 6 data-gated cards: 1 template/detector/contract change + port each.
- Net: the visual system is a **clean port**; the real cost is the ~6 pipeline shapes, which are
  incremental and independently shippable.
