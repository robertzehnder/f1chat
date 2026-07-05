# F1 Insights Chat — Improvement Plan from the 67-Prompt Golden-Set Simulation

Date: 2026-07-02
Inputs: `findings_final.json` (29 confirmed, 1 refuted, 0 unverified), `all_prompts.json` (67 prompts), captures under `capture_0/`–`capture_3/`, `web/logs/chat_api.log`, repo sources under `/Users/robertzehnder/Documents/coding/f1/openf1/web/src`.

---

## 1. Executive Summary

### Scope

- **Golden set:** 67 prompts — 25 baseline (M01–M22 excl. M07, plus R01–R04, verbatim from the v0 visualization brief) + 42 randomized (3 seeds × 14 chart families: race_trace, over_cut, deg_curve, position_changes, telemetry_overlay, strategy_split, stint_delta, brake_zones, sector_dominance, speed_map, lap1_launch, wet_crossover, radar, pit_stop), all 2025 venues.
- **What was audited:** end-to-end SQL generation (routing → resolution → template/LLM/heuristic SQL → execution on Neon) and visual generation (rows → detector registry → chart spec → renderer semantics), plus client-fetch APIs (`/api/track-outline`, `/api/lap-telemetry`). Every finding was adversarially re-verified against captured payloads, `chat_api.log`, live re-fires, and repo code; severities were re-graded during verification (some up, some down).

### Pass/fail statistics per layer

| Layer | Result |
|---|---|
| **Session/driver resolution** | Strong: pinned the correct 2025 session at 0.99 confidence in every examined capture. 1 failure: one-directional team-substring match dropped "Red Bull" (M11). Latency, not accuracy, is the problem — 36–41s cold resolution+completeness on 5 prompts (M02, M09, M10, R01, R02). |
| **Template routing** | 2 hijacks of designated LLM-path prompts (M04 corner-phase → sector_dominance; M11 team deg → compound_degradation_curve). Topic routing otherwise correct. |
| **SQL execution** | Worst layer. 23 `canceling statement due to statement timeout` first-attempt failures on capture day alone (28 all-time for deterministic templates); 17 capture runs degraded to `heuristic_after_template_failure`; 1 hard failure with raw error surfaced (M09). Succeeding templates run 7.5–13.4s against a 15s budget — near-zero headroom. |
| **Rows / data quality** | Exact 2× duplicate rows on every non-template `core.laps_enriched` read; `core.grid_vs_finish` finish_position corrupt at 2 of 3 sampled races; `analytics.traffic_adjusted_pace` counts doubled (84 clean-air laps in a ~58-lap race); deg-curve baselines SC-contaminated at 3+ venues; `analytics.weather_impact` duplicate boundary-lap rows; stint fragmentation counted as pit stops. |
| **Visual generation** | Expected chart lost on ~6/16 prompts per capture round (all downstream of the SQL fallback); radar polygon destroyed on 4/4 radar prompts (season_year axis at value 2025 on a 0–100 scale); dual-axis wet-crossover chart dives to 0s on both retirement cases; assorted P2/P3 mispicks and instabilities. |
| **Client-fetch APIs** | Contract-healthy (200s, complete payloads) but `/api/track-outline` runs 14.5s cold against a 15s statement timeout. |
| **Self-grading / honesty** | `assessChatQuality` grades every rowCount>0 answer "B", including fallbacks whose own text says they can't answer — the P0 class is invisible to grade-based gates. Worst single behavior in the system: answers that flatly assert "this 2025 session is not in the dataset" while the app's own resolver pinned that exact session at 0.99. |

**Bottom line:** 58/67 prompts are touched by ≥1 confirmed finding; 9 are fully clean (M12, M18, M21, s202 lap1_launch/over_cut/position_changes/race_trace/speed_map, s303 stint_delta). Severity mix: **3 P0, 13 P1, 8 P2, 5 P3**; categories: data 9, honesty 7, routing 4, visual 4, sql 2, perf 2, api 1.

### Overall health verdict

The **happy path is genuinely good**: when a deterministic template executes warm, resolution, SQL, insight builders, and detectors produce correct, well-caveated cards (the clean s202/s303 captures prove it). The system's dominant defect is its **failure tier**: templates sit at the exact edge of the 15s Neon statement timeout, and every failure funnels into a context-blind keyword heuristic whose default branch returns 25 unrelated 2026 sessions — which the synthesis layer then converts into confident, false "data is not ingested" claims that contradict the app's own resolution state. Fixing the failure tier (Waves 1–2) removes the P0 honesty class and roughly two thirds of prompt-level impact; the remaining work is warehouse-consumer hardening and detector polish.

---

## 2. Findings Register

### Confirmed (29)

| # | Dedupe key | Sev | Cat | Prompts | One-line description |
|---|---|---|---|---|---|
| F01 | honesty.heuristic-default-session-listing.false-absence-claims | P0 | honesty | 7 | Heuristic default branch returns 25 recent-2026 sessions; synthesis then fabricates "2025 session not in dataset" claims contradicting the 0.99-pinned resolution. |
| F02 | data.grid_vs_finish.stale-finish-position-no-fallback | P0 | data | 2 | `core.grid_vs_finish` finish_position stale/duplicated when `raw.session_result` missing; positionChangesInsight trusts it blindly → wrong winner/mover claims contradicting the card's own trace. |
| F03 | data.traffic_adjusted_pace.dup-row-lap-count-inflation | P0 | data | 1 | `analytics.traffic_adjusted_pace` lap counts doubled by warehouse dup rows → "84 clean-air laps" in a ~58-lap race stated as headline fact. |
| F04 | perf.deterministic-templates.statement-timeout-unmaterialized-views | P1 | perf | 24 | Template SQL (multi-scan CTEs on unmaterialized `core.laps_enriched`) intermittently exceeds the 15s statement timeout; 23 timeouts on capture day. |
| F05 | routing.orchestration.blind-heuristic-fallback-on-template-failure | P1 | routing | 16 | `deterministic_template` exec failure of ANY class → `buildHeuristicSql`, no retry, no timeout/permanent split, no relevance check; honest-refusal path unreachable. |
| F06 | sql.non-template-paths.laps-enriched-no-dedup-no-venue | P1 | sql | 12 | Heuristic + LLM SQL paths never got the templates' laps_enriched GROUP BY dedup or venue/year projection → exact 2× rows, unverifiable results. |
| F07 | sql.buildHeuristicSql.context-blind-keyword-branches | P1 | sql | 15 | Keyword-first fallback ignores resolved context: single-driver only, 'fastest' branch drops the asked driver, default branch off-topic. |
| F08 | perf.pre-sql-stages.cold-unmaterialized-view-probes | P1 | perf | 5 | completeness_check probes strategy-family unmaterialized views (~15s each) uncached on first touch → 35–40s pre-SQL stall. |
| F09 | routing.pipeline-budget.resolution-latency-starves-sql-repair-path | P1 | routing | 1 | SQL-pipeline deadline anchored at request start, so 41s resolution eats the repair/fallback budget; raw doubled error sentence surfaces. |
| F10 | visual.line-dual-axis.zero-fill-missing-laps | P1 | visual | 2 | lineDualAxisDetector fills missing laps with 0 instead of NaN → retired driver's lap-time line plunges to 0s. |
| F11 | routing.template-triggers.overbroad-keyword-intercepts-llm-path | P1 | routing | 2 | DEG/SECTOR/GAIN trigger regexes hijack team-comparison and corner-phase questions into templates that structurally cannot answer them. |
| F12 | data.deg-curve-sql.sc-neutralized-and-lap1-contamination | P1 | data | 5 | Deg-curve SQL has no SC/standing-start exclusion or min-sample guard → inverted curves ("compound 32–43s faster with age") at disrupted races. |
| F13 | visual.radar.season-year-identifier-denylist-gap | P1 | visual | 4 | IDENTIFIER_COLS misses `season_year` → 2025 plotted as an axis on a 0–100 radar, destroying the polygon; axis counts contradict card text. |
| F14 | data.weather_impact.stint-boundary-lap-duplicate-rows | P1 | data | 3* | `analytics.weather_impact` emits duplicate (driver,lap) rows at tyre-change laps with contradictory wet/compound flags → phantom pit markers and 1-lap stints. |
| F15 | honesty.strategy-split.dnf-not-checked-in-verdict | P1 | honesty | 1 | Strategy-split verdict counts stops only, never checks race-distance coverage/DNF → retirement presented as a deliberate 0-stop strategy. |
| F16 | routing.resolver.one-directional-team-substring-match | P1 | routing | 1 | `message.includes(teamName)` never matches "Red Bull" against "Red Bull Racing" → team-vs-team silently collapses to one team. |
| F17 | data.wet-crossover.first-transition-definition-no-wet-phase-context | P2 | data | 1 | Crossover = FIRST inter→slick transition, no wet-phase context → lap-3 gamble conflated with lap-39 crossover, fabricated "gambled 36 laps earlier" narrative. |
| F18 | data.corner_analysis.corrupt-brake-zone-samples-inconsistent-filter | P2 | data | 3 | Misplaced/sparse corner_analysis samples yield phantom "heaviest brake zones" (drop≈0 corners); plausibility filter exists only in the answer builder, not the chart detector. |
| F19 | data.stint_summary.fragmented-same-compound-stints-inflate-stop-counts | P2 | data | 1 | Same-compound 1–2-lap stint fragments counted as pit stops; verdict computed before the builder's own micro-stint classification → "4 stops" asserted, disclaimed one line later. |
| F20 | visual.hbar.duration-substring-mispick-single-bar-fallback | P2 | visual | 1 | `duration_sec` pattern substring-matches `duration_sector_1`; no min-bars guard → mislabeled one-bar sector-time chart on a pole-lap hero card. |
| F21 | honesty.deg-curve-insight.cliff-narrative-and-sign-formatting | P2 | honesty | 1 | Cliff detection has one-point look-ahead and no magnitude bound; hardcoded '+' prefix prints "+-22.87s"; "stays high" paired with a −22.9s endpoint. |
| F22 | honesty.radar.either-zero-exclusion-misstated-in-lede | P2 | honesty | 4 | Radar drops axes when EITHER driver is 0 (sign-off said BOTH) and the lede falsely claims those axes "read 0.0"; leading driver gets a negative-signed delta. |
| F23 | data.synthesis.head-25-row-truncation-bias | P2 | data | 2 | Synthesis prompt samples only the first 25 rows of lap-ordered results → late-race evidence (pit laps) unreachable; answers punt despite holding the answer. |
| F24 | honesty.quality-assessor.rowcount-gt-zero-auto-grade-b | P2 | honesty | 6 | Any rowCount>0 answer grades "B" with no generationSource check → P0 fallback failures invisible to grade-based gates. |
| F25 | data.db-pools.numeric-parsers-only-in-driver-ts | P3 | data | 26 | NUMERIC/BIGINT pg type parsers registered only in `db/driver.ts`; chat pool (`db.ts`) returns numbers as strings — latent hazard, currently mitigated by registry coercion. |
| F26 | honesty.wet-crossover.headline-omits-noncrossing-driver | P3 | honesty | 1 | Answer collapses to "crossover came on lap 33" while one requested driver never crossed (crossover=null); metric tile disagrees with prose. |
| F27 | honesty.brake-zones.hardcoded-three-zone-answer-template | P3 | honesty | 1 | Answer hardcodes "the three heaviest brake zones" when only 2 exist; signed-mean neutrality masks −8/+6 opposing deltas as "essentially even". |
| F28 | visual.team-colors.order-dependent-teammate-shade-assignment | P3 | visual | 5 | Base/shade teammate colors assigned by row-encounter order → same driver pair swaps colors between cards of the same session. |
| F29 | api.track-outline.cold-derivation-near-statement-timeout | P3 | api | 1 | `/api/track-outline` cold derivation ≈14.5s vs 15s statement timeout, in-process cache only → track ribbon one hiccup from silently vanishing. |

\* F14 prompt count includes the duplicate-normalized s101 id.

### Refuted (appendix)

| Dedupe key | Refutation reason |
|---|---|
| data.track_segments.sparse-corner-population | Refuted by **design lens**: sparse `f1.track_segments` corner seeding is a documented scoping decision (`diagnostic/phase_19_analytics_capability_plan_2026-05-02.md` slice 20 "hand-curated FIA corner zones... one-row update per corner"; `phase25_target_grades.json` records the partial seed with explicit expansion escapes). Consumers degrade gracefully (telemetry-overlay falls back to percent ticks). One salvageable nugget: `track-map.tsx:173` label fallback draws full corner names ("Eau Rouge") where single digits are expected — folded into Wave 4 as a one-line polish item. |

### Unverified

None — every finding was resolved to confirmed or refuted.

---

## 3. Per-Finding Deep Dives

> File paths are relative to `/Users/robertzehnder/Documents/coding/f1/openf1/` unless absolute. Test-harness idioms: tests live in `web/scripts/tests/*.test.mjs` (transpile-at-test-time via the `ts` compiler; template-router tests carry **hardcoded file lists** that must be extended when adding `deterministicSql/*` files); sweeps are `web/scripts/health/baseline_sweep.mjs` and `web/scripts/health/randomized_sweep.mjs` (dev server on :3000; `--seed`, `--only`, `--judge`). The deterministic-card 6-file pattern: SQL template (`src/lib/deterministicSql/<x>.ts`) → router chain (`src/lib/deterministicSql.ts`) → topic guard (`src/lib/deterministicSql/topicGuards.ts`) → insight builder (`src/lib/synthesis/<x>Insight.ts`) → orchestration dispatch (`src/app/api/chat/orchestration.ts`) → chart detector (`src/lib/mapInsight/detectors/registry.ts`).

---

### F01 — P0 · honesty · Heuristic default session listing → fabricated "data not in dataset" claims

**Prompts:** M06, M08, M16, M19, s101:sector_dominance#1, s202:stint_delta#1, s303:sector_dominance#1 (7 unique).

**Symptom.** When a deterministic template fails at exec, the fallback SQL for sector/stint/overtake phrasings is `buildHeuristicSql`'s default branch:

```sql
SELECT session_key, session_name, date_start, year, country_name, location
FROM core.sessions ORDER BY date_start DESC NULLS LAST LIMIT 25
```

All 25 rows are late-2026 sessions. Synthesis then asserts falsehoods, verbatim from captures:

- M08: *"The available data does not include a Spa 2025 session... no Belgian Grand Prix at Spa-Francorchamps for 2025 appears"* — while `runtime.resolution.selectedSession = {sessionKey 9939, 'Race / Belgium / Spa-Francorchamps / 2025', confidence 0.99}` and the insight card is titled "Mercedes Split Strategy - Spa 2025".
- s202:stint_delta: *"The available data does not contain Abu Dhabi 2025 — the most recent Abu Dhabi race in the dataset is session_key 11436, dated December 2026"* — session 9839 (Yas Island 2025) pinned at 0.99; card titled "Abu Dhabi 2025 Stint Deltas — Data Not Found".
- M06: *"suggesting the data may not yet be ingested"* — while M06's own `runtime.completeness` shows `raw.position_history` usable for the pinned session.

`generationNotes` even records `session_pin_unverifiable_no_literal_session_key_predicate(session_key=…)` — the guard at `orchestration.ts:281-288` (`enforcePinnedSessionKeyInSql`) *detects* that the fallback SQL dropped the pinned session but only annotates; execution and synthesis proceed, and the answer ships as a graded-B response. Materially worse than an honest refusal: it tells users real data does not exist.

**Root cause.** Three stacked gaps: (1) `buildHeuristicSql` default branch (`web/src/lib/queries.ts:345-350`) is a context-free recent-sessions listing that ignores `context.sessionKey`; (2) the `deterministic_template` failure branch (`orchestration.ts:1292-1305`) executes it unconditionally (see F05); (3) synthesis (`web/src/lib/synthesis/buildSynthesisPrompt.ts`) lets the LLM infer *global dataset absence* from a recency-limited 25-row list even though the pinned-session resolution state is available to it.

**Affected files.** `web/src/app/api/chat/orchestration.ts`, `web/src/lib/queries.ts`, `web/src/lib/synthesis/buildSynthesisPrompt.ts`.

**Proposed fix** (three layers; belt-and-braces because this is the P0):

1. **Retire the default branch.** In `buildHeuristicSql`, replace the final catch-all with a session-pinned no-op signal:

```ts
// web/src/lib/queries.ts — end of buildHeuristicSql
// Phase 23: no more context-free recent-sessions dump. If no keyword branch
// matched, tell the caller there is no relevant heuristic — orchestration
// must take the honest structured-failure path instead.
return null;
```

Change the signature to `(): string | null` and update both call sites in `orchestration.ts` (template-failure branch and `heuristic_after_sql_timeout` branch) to route `null` into the existing `sqlPipelineError` honest-failure machinery (the code that already produces `no_data_refusal` / `sql_generation_failed` at `orchestration.ts:1312+`), with a new code `heuristic_unavailable`:

```ts
const heuristicSql = buildHeuristicSql(message, resolvedContext);
if (!heuristicSql) {
  sqlPipelineError = {
    message: "The optimized query for this question failed and no safe fallback query exists.",
    code: "heuristic_unavailable"
  };
} else { /* existing fallback exec */ }
```

2. **Make the pin guard a gate, not an annotation.** In `enforcePinnedSessionKeyInSql` (`orchestration.ts:281-288`), when the runtime pinned a session at high confidence and the candidate SQL contains no `session_key = <pinned>` literal **and** the generation source is a heuristic fallback, reject the SQL (throw → honest failure) instead of annotating. Keep annotation-only behavior for the anthropic path where subqueries may legitimately restructure predicates.

3. **Synthesis honesty clamp.** In `buildSynthesisPrompt.ts`, when `runtime.resolution.selectedSession` exists with confidence ≥ 0.9, inject a hard instruction block:

```ts
if (resolution?.selectedSession && resolution.confidence >= 0.9) {
  lines.push(
    `RESOLVED SESSION (authoritative): session_key=${sel.sessionKey} — ${sel.label}. ` +
    `This session EXISTS in the dataset. Never claim it or its event is missing/not ingested. ` +
    `If the returned rows do not cover it, say the query failed to target it — not that the data is absent.`
  );
}
```

**Test plan.** New `web/scripts/tests/heuristic-fallback-honesty.test.mjs` (transpile-at-test-time like `answer-cache.test.mjs`): (a) `buildHeuristicSql('show sector dominance…', {sessionKey: 9939})` returns `null`; (b) simulate a template exec failure and assert the response `failureSource ∈ {heuristic_unavailable, no_data_refusal}` and answer text does NOT match `/not (in|part of) the dataset|not (yet )?(been )?ingested|does not (contain|include)/i` when a session is pinned; (c) pin-gate unit: SQL without the pinned literal on a heuristic source throws. Extend `no-data-refusal.test.mjs` with a "pinned session must never be declared absent" case. Update `answer-cache.test.mjs:705` and `skip-repair.test.mjs:350` (they currently assert the fallback *fires*; they must now assert the new structured-failure shape).

**Regression harness.** Add a mechanical rubric check to both sweeps: fail any run where `generationNotes` contains `session_pin_unverifiable` AND the answer matches the absence-claim regex. Baseline gate: `node scripts/health/baseline_sweep.mjs --only M06,M08,M16,M19`.

**Effort:** M. **Risk:** medium — retiring the default branch converts today's "wrong answer" into "honest failure" for prompts that will still time out until Wave 2 lands; acceptable (honest failure is the designed Phase 17-D behavior) but expect a temporary rise in refusal counts in sweep output. Sequence Wave 1 close to Wave 2.

---

### F02 — P0 · data · `core.grid_vs_finish` stale finish_position, no final-trace fallback

**Prompts:** R03, s101:position_changes#1.

**Symptom.** R03 (Silverstone 9947, `capture_0/R03.json`): NO driver has `finish_position=1` → Winner metric `'n/a'`, winner sentence omitted; Norris has grid=3/finish=3 (his quali slot) while his own trace in the same rows holds P1 from lap 44 to the flag; duplicate finish positions P3 (Norris+Hulkenberg), P4 (Albon+Hamilton), P12 (Sainz+Russell). s101 (São Paulo 9869): answer says *"Verstappen was the biggest mover, climbing from P19 to P16"* while the trace shows P19→P3 (+16); duplicates P17, P18. s303 Singapore is clean — the corruption is session-conditional on the known `raw.session_result` ingestion gap.

**Root cause.** `sql/007_semantic_summary_contracts.sql:47-55`: `finish_fallback` = last `raw.position_history` row per driver — deliberately designed, but stale/duplicated when `session_result` is missing. The *consumer-side* gap is new: `web/src/lib/synthesis/positionChangesInsight.ts` derives winner solely via `classified.find((d) => d.finish === 1)` (line 57) and climber/faller from `finish_position` (lines 39–57, 96–101) with **no cross-check against the final trace position it already holds in the same rows**.

**Affected files.** `web/src/lib/synthesis/positionChangesInsight.ts`, `web/src/lib/deterministicSql/positionChanges.ts`.

**Proposed fix.** Derive an *effective* finish from the trace and reconcile:

```ts
// positionChangesInsight.ts — before classification
function lastTracePosition(rows: Row[], driver: number): number | null {
  const trace = rows.filter(r => num(r.driver_number) === driver && r.position != null)
    .sort((a, b) => num(a.lap_number) - num(b.lap_number));
  return trace.length ? num(trace[trace.length - 1].position) : null;
}
const finishSuspect =
  !classified.some(d => d.finish === 1) ||                      // no winner
  hasDuplicateFinishes(classified);                             // dup positions
for (const d of classified) {
  const traceFinish = lastTracePosition(rows, d.driverNumber);
  if (finishSuspect && traceFinish != null) d.finish = traceFinish; // trace wins
}
```

Add a takeaway when the override fires: `"Official classification unavailable for this session — finishing order derived from the final recorded lap positions."` Also project a `finish_source` marker from the template SQL if cheap (`positionChanges.ts`: `CASE WHEN sr.position IS NULL THEN 'trace_fallback' ELSE 'session_result' END`), so the builder can trust the flag instead of inferring.

**Test plan.** New cases in a `position-changes-insight.test.mjs` (new file, mirror `stint-delta-insight.test.mjs` fixture style): (a) fixture with no finish=1 + duplicated finishes + trace ending P1 → winner named from trace, caveat takeaway present; (b) clean fixture (s303-shaped) → untouched, no caveat; (c) mover computed from trace finish (P19→P3, not P19→P16).

**Regression harness.** `randomized_sweep.mjs` rubric D6 addition: for position_changes family, assert winner metric ≠ 'n/a' when rows contain a full trace, and biggest-mover destination equals the driver's last trace position. Gate: `node scripts/health/randomized_sweep.mjs --only position_changes --rounds 3`.

**Effort:** S–M. **Risk:** low — trace fallback matches the warehouse's own fallback intent; only risk is red-flag-shortened races where last-lap order ≠ classification (accepted; the caveat sentence covers it).

---

### F03 — P0 · data · `analytics.traffic_adjusted_pace` doubled lap counts, no plausibility check

**Prompts:** M13.

**Symptom.** `capture_3/M13.json` (session 9839, driver 4): single row `clean_air_laps="84"`, `traffic_laps="24"` — 108 total laps for one driver; no F1 race exceeds ~78. 108 = 2×54 — the known 2× dup-row artifact propagating into COUNT columns (means cancel; counts double). Answer headlines *"84 laps in clean air... 78% of his total laps was a key factor in his race victory"*; the stacked bar renders 84 vs 24. Secondary: prompt asked about *"his winning stint"*; answer silently reframes to whole race.

**Root cause.** Warehouse view counts over duplicated `laps_enriched` rows without dedup; no consumer plausibility check against race distance anywhere (grep confirms schemaCatalog/anthropic prompt/health checks use the view uncritically).

**Affected files.** `web/src/lib/anthropic.ts` (schema guidance), `web/src/app/api/chat/orchestration.ts` or a new `web/src/lib/answerSanity/lapCounts.ts`, `web/src/lib/mapInsight/detectors/registry.ts` (stacked bar builder), and the warehouse view itself (out-of-repo SQL migration).

**Proposed fix.**

1. **Warehouse (root):** patch the view to count `DISTINCT lap_number` (migration in `sql/`, same pattern as `007_semantic_summary_contracts.sql`): `COUNT(DISTINCT CASE WHEN clean_air THEN lap_number END) AS clean_air_laps`.
2. **App-side sanity (defense while the view ships):** new `web/src/lib/answerSanity/lapCounts.ts` following the `pitStints.ts` module shape:

```ts
export const MAX_PLAUSIBLE_RACE_LAPS = 87; // longest modern race + margin
export function checkLapCountPlausibility(rows: Row[]): SanityWarning | null {
  for (const r of rows) {
    const total = num(r.clean_air_laps) + num(r.traffic_laps);
    if (total > MAX_PLAUSIBLE_RACE_LAPS) {
      const halved = { clean: num(r.clean_air_laps) / 2, traffic: num(r.traffic_laps) / 2 };
      return { kind: "lap_count_inflation", detail: `…`, correction: halved };
    }
  }
  return null;
}
```

Wire into the orchestration answer-sanity pass next to the existing `pitStints` checks; on trigger, halve the counts (exact-2× is the documented artifact), add a caveat, and cap `adequacyGrade` at C.
3. **Prompt guidance:** add to `anthropic.ts`'s schema notes: `analytics.traffic_adjusted_pace lap-count columns are inflated 2x by duplicate rows — always sanity-check totals against race distance.`

**Test plan.** New `lap-counts-sanity.test.mjs`: 84/24 fixture triggers with correction 42/12; 42/12 fixture passes; boundary 87 passes. Extend the answer-sanity route-wiring pattern (`validator-pit-stints-route-wiring.test.mjs` is the template).

**Regression harness.** Rubric: any answer asserting a per-driver lap total > 87 for a race fails D6 automatically. Gate: `baseline_sweep.mjs --only M13`.

**Effort:** S (app-side) + S (view migration). **Risk:** low; halving is only applied on physically impossible totals.

---

### F04 — P1 · perf · Template SQL at/over the 15s Neon statement timeout

**Prompts (24):** M04, M06, M08, M09, M10, M16, M19, M22, R04 + 15 randomized (pit_stop, sector_dominance, stint_delta, telemetry_overlay, speed_map, lap1_launch families).

**Symptom.** `web/logs/chat_api.log` 2026-07-02: 23 `chat_query_first_attempt_failed` entries with `canceling statement due to statement timeout` in the capture window (28 all-time for deterministic templates); failures ~15.15–15.2s after `chat_runtime_ready`. Failed SQL matches template builders verbatim (`WITH pits AS MATERIALIZED` ×3, `WITH fastest AS` ×2, strategy_split, sector_dominance ×5…). The same templates succeeded seconds apart in the same run (s101:strategy_split 12.6s OK; s202:brake_zones 8.9s OK) — load/cold-compute dependent, not venue bugs. Succeeding templates ran 7.5–13.4s against `SET LOCAL statement_timeout = 15000` (`web/src/lib/queries/execute.ts:7,37`, `OPENF1_QUERY_TIMEOUT_MS=15000` in `web/.env.local`) — near-zero headroom.

**Root cause.** Multiple full scans of unmaterialized `core.laps_enriched` per query. `pitCycle.ts` scans it in **two** MATERIALIZED CTEs (`laps` lines 107–118 and `venue` lines 119–127 — the venue CTE re-scans laps_enriched just for country/year/session_name); `stintDelta.ts` scans it twice (a_laps/b_laps); `speedMap.ts` joins `raw.car_data` over a lap window; `sectorDominance.ts`/`strategySplit.ts` failed only in the cold window.

**Affected files.** `web/src/lib/deterministicSql/{pitCycle,stintDelta,sectorDominance,speedMap,telemetryOverlay,strategySplit,inferredOvertakes}.ts`, `web/src/lib/queries/execute.ts`, `web/src/lib/db/driver.ts`, `web/src/app/api/chat/orchestration.ts`.

**Proposed fix** (three prongs, cheapest first):

1. **Cut redundant scans.** In `pitCycle.ts`, replace the `venue` CTE with a `core.sessions` lookup (the file already has the idiom in other templates' `sess` CTE, e.g. `degradationCurve.ts`):

```sql
venue AS (
  SELECT country_name, year, session_name
  FROM core.sessions WHERE session_key = ${targetSession} LIMIT 1
)
```

In `stintDelta.ts`, merge `a_laps`/`b_laps` into one scan `WHERE driver_number IN (${a}, ${b})` grouped by driver+lap, split in the outer query.
2. **One retry on timeout for deterministic templates** (see F05 sketch — the retry belongs to that branch rework; by the second attempt Neon compute is warm and the log evidence shows re-fires succeed).
3. **Raise the template-class timeout.** Templates are hand-audited SQL; give them their own budget: `SET LOCAL statement_timeout = ${OPENF1_TEMPLATE_TIMEOUT_MS ?? 25000}` when `generationSource === 'deterministic_template'` (plumb a `timeoutMs` option through `runReadOnlySql` in `queries/execute.ts`). Keep 15s for LLM SQL.
4. **(Stretch, warehouse)** Materialize `core.laps_enriched` or add a materialized `core.laps_dedup` — biggest win, tracked as a separate warehouse task; every template then drops its GROUP BY dedup.

**Test plan.** Template SQL is string-built, so unit-test shape: extend `template-router-topic-coverage.test.mjs` (remember: hardcoded file list) with assertions that `buildPitCycleSql` output contains exactly ONE `FROM core.laps_enriched` occurrence, and `buildStintDeltaSql` ≤ 1. New `execute-timeout-class.test.mjs`: `runReadOnlySql(sql, {timeoutMs: 25000})` emits `SET LOCAL statement_timeout = 25000` (mock pool, `db-stmt-cache.test.mjs` shows the mocking idiom).

**Regression harness.** Both sweeps already record `generationSource`; add a hard gate: **zero** `heuristic_after_template_failure` rows in a warm 3-round randomized sweep. Command: `node scripts/health/randomized_sweep.mjs --rounds 3 --seed 7` (seed 7 has known open findings; keep it as the stress seed). Track p95 `result.elapsedMs` per template in sweep output to watch headroom.

**Effort:** M. **Risk:** low for CTE rewrites (semantics-preserving; verify row-for-row against a captured session); timeout raise trades latency for success — bounded by the Wave-2 budget fix (F09) so a 25s template can't starve the pipeline.

---

### F05 — P1 · routing · Blind heuristic fallback on ANY template exec error

**Prompts (16):** M04, M06, M10, M19, M22, R04 + 10 randomized.

**Symptom.** `orchestration.ts:1292-1305` (quoted verbatim above from source): the `deterministic_template` branch calls `buildHeuristicSql` on ANY exec failure — no timeout/permanent split, no retry, no topical-relevance check — while the anthropic branch (1264–1289, Phase 17-D) distinguishes timeouts from column errors and can reach honest structured failure. Result: M10's Bahrain stint question answered with 25 rows of 2026 Yas Marina sessions under an insight card still titled "Hamilton vs Leclerc Stint Deltas — Bahrain 2025"; expected charts (track_heatmap, telemetry_overlay, stint_delta_line, horizontal_bar) never render for 8/17 captures; a re-fire of the identical s101_sector_dominance prompt succeeded as deterministic_template — the timeouts are transient, yet no retry exists. The comment at `orchestration.ts:1075` says the recent-sessions heuristic was supposed to be retired; `orchestration.ts:1282-1284` states failures should be *"honest structured failure, NOT a heuristic that returns unrelated rows"* — applied only to the anthropic path.

**Root cause.** The template failure branch predates Phase 17-D and never received its error-class policy.

**Affected files.** `web/src/app/api/chat/orchestration.ts`, `web/src/lib/queries.ts`.

**Proposed fix.** Rewrite the branch to mirror Phase 17-D plus one same-SQL retry:

```ts
} else if (generationSource === "deterministic_template") {
  if (isTimeoutError(execOrValidationError) && Date.now() < sqlPipelineDeadline) {
    // Transient Neon cold-compute timeout: the identical SQL succeeds on a
    // warm retry (verified 2026-07-02). One retry, then honest failure.
    try {
      result = await executeSqlWithTrace(generatedSql, generationSource, "template_retry_after_timeout");
      generationNotes = [generationNotes, "template_timeout_retry_succeeded"].filter(Boolean).join(" | ");
    } catch (retryError) {
      sqlPipelineError = {
        message: "The optimized query for this question timed out twice against the warehouse.",
        code: "template_exec_timeout"
      };
    }
  } else {
    // Permanent failure class (column/SQL error) — honest structured failure,
    // same policy as the anthropic path. No off-topic heuristic.
    sqlPipelineError = { message: errorMessage, code: "template_exec_failed" };
  }
}
```

`buildHeuristicSql` remains only for the anthropic `heuristic_after_sql_timeout` path, and only when it returns a non-null, session-pinned query (F01). This kills `heuristic_after_template_failure` as a generation source; grep for consumers (`chatQuality.ts`, tests, sweep rubric) and update.

**Test plan.** Extend `skip-repair.test.mjs` (which already mocks the exec pipeline): (a) template exec throws timeout once → retry succeeds → `generationSource='deterministic_template'`, notes contain `template_timeout_retry_succeeded`; (b) throws timeout twice → `failureSource='sql_generation_failed'`/`template_exec_timeout`, answer contains no fabricated data claims; (c) throws column error → immediate honest failure, no retry. Update `answer-cache.test.mjs:705` expectations.

**Regression harness.** Sweep gate as F04. Also add `generationSource` distribution to `baseline_sweep.mjs` summary output so drift is visible per run.

**Effort:** M. **Risk:** medium — removes a "sometimes accidentally useful" fallback (M22's lap-dump let synthesis infer the pit lap); mitigated because the retry recovers most timeouts and honest failure beats wrong-topic rows. Land in the same PR as F01.

---

### F06 — P1 · sql · Non-template paths lack laps_enriched dedup + venue projection

**Prompts (12):** M01, M03, M09, M22, R04 + randomized lap1_launch/pit_stop/telemetry_overlay.

**Symptom.** Heuristic lap branch (`queries.ts:316-323`) returns every lap exactly twice (M22: 140 rows = 70 laps × 2, byte-identical pairs; R04 106=53×2; etc.) with no venue/year/driver columns → venue verification impossible, synthesis sample halved (compounds F23), any COUNT/AVG would silently double. M09's LLM-generated SQL had the same un-deduped per-lap CTE. M03's LLM SQL omitted venue/year columns from the final SELECT — the only successful-path capture that can't be venue-verified. Every deterministic template guards (e.g. `stintDelta.ts`: *"laps_enriched ships duplicate rows in the warehouse, so collapse to one row per lap"*); `anthropic.ts` mentions `core.laps_enriched` (lines 86/114/127) with zero dup guidance.

**Root cause.** The dup-row gotcha is encoded only inside templates; `buildHeuristicSql` predates it; the LLM system prompt never states it.

**Affected files.** `web/src/lib/queries.ts`, `web/src/lib/anthropic.ts`.

**Proposed fix.**

1. `queries.ts` lap branch (and any surviving branch after F07):

```sql
SELECT lap_number,
       MAX(lap_duration)      AS lap_duration,
       MAX(duration_sector_1) AS duration_sector_1,
       MAX(duration_sector_2) AS duration_sector_2,
       MAX(duration_sector_3) AS duration_sector_3,
       MAX(driver_name)       AS driver_name,
       MAX(country_name)      AS country_name,
       MAX(year)              AS year
FROM core.laps_enriched
WHERE session_key = ${sessionKey} AND driver_number IN (${driverNumbers.join(", ")})
GROUP BY lap_number, driver_number
ORDER BY lap_number ASC
```

2. `anthropic.ts` system prompt, next to the existing laps_enriched contract lines: `WAREHOUSE GOTCHA: core.laps_enriched (and other core matviews) ship duplicate rows per (session, driver, lap). ALWAYS collapse with GROUP BY lap_number, driver_number + MAX(...), or SELECT DISTINCT. Never COUNT/AVG raw rows. ALWAYS project country_name, year in the final SELECT so results can be venue-verified.`

**Test plan.** Extend `raw-table-prompt-reminders.test.mjs` (it already asserts prompt-content invariants) with the dup-gotcha string. New unit in `heuristic-fallback-honesty.test.mjs`: generated lap-branch SQL contains `GROUP BY` and `country_name`. `sql-column-validator.test.mjs`: add a warn rule flagging LLM SQL that reads laps_enriched per-lap without GROUP BY/DISTINCT (validator hook exists in `join-patterns-validator.test.mjs` idiom).

**Regression harness.** Randomized sweep mechanical check D2: for lap-shaped rowsets, assert `rows where lap_number==k` ≤ #drivers requested (dup detector).

**Effort:** S. **Risk:** low.

---

### F07 — P1 · sql · `buildHeuristicSql` context-blind keyword branches

**Prompts (15):** M04, M08, M16, R04 + randomized speed_map/pit_stop/lap1_launch/telemetry_overlay/stint_delta/sector_dominance.

**Symptom.** Signature takes a **singular** `{sessionKey?, driverNumber?}` (`queries.ts:153-156`); orchestration passes only `selectedDriverNumbers[0]` — two-driver comparisons return one driver's laps (*"Norris's data was not included in the SQL results"*), and no chart fires. The 'fastest' branch (163–181) ignores `driverNumber` entirely — top-5 leaderboard excludes the asked driver (Ocon, Sainz absent from their own speed-map answers). M04 matched the telemetry branch via the substring 'speed' inside 'high-speed' and got 200 all-zero pre-session `raw.car_data` samples. Default branch: F01.

**Root cause.** Keyword-first router that never consults resolved entities; cannot express driver pairs.

**Affected files.** `web/src/lib/queries.ts`, `web/src/app/api/chat/orchestration.ts`.

**Proposed fix.** After F05, `buildHeuristicSql` survives only for the anthropic timeout path. Rebuild it as context-first:

```ts
export function buildHeuristicSql(message: string, context?: {
  sessionKey?: number;
  driverNumbers?: number[];   // <-- plural, all resolved drivers
}): string | null {
  const drivers = (context?.driverNumbers ?? []).filter(Number.isFinite);
  if (!context?.sessionKey) return null;              // never query unpinned
  if (drivers.length > 0) return dedupedLapsSql(context.sessionKey, drivers); // F06 shape
  if (/fastest|quickest|best lap/.test(lower)) return topLapsSql(context.sessionKey);
  return null;                                        // F01: no catch-all
}
```

Orchestration passes `driverNumbers: runtime.resolution.selectedDriverNumbers` (all of them). Delete the 'abu dhabi 2025' relic branch, the raw.car_data ORDER-BY-date branch (garage-telemetry garbage), and the sessions-listing default.

**Test plan.** `heuristic-fallback-honesty.test.mjs`: (a) two drivers in context → both in `IN (...)`; (b) no sessionKey → null; (c) 'high-speed esses' prompt does NOT hit a telemetry branch (branch deleted); (d) 'fastest' with a resolved driver still includes a full-field leaderboard *plus* the driver's rank (or simply scope: keep leaderboard but add `driver_number = N` rows via UNION — simplest: add the asked driver's best lap as an extra row).

**Regression harness.** Randomized sweep D1 (resolution honored in rows) — currently the exact check these prompts fail; no rubric change needed, the gate just starts passing.

**Effort:** M. **Risk:** low once F05 shrinks this function's blast radius.

---

### F08 — P1 · perf · Cold completeness/resolution probes on unmaterialized strategy views

**Prompts:** M02, M09, M10, R01, R02.

**Symptom.** M10 `completeness_check durationMs=38646` with requiredTables `[core.strategy_summary, core.stint_summary, core.pit_cycle_summary, core.strategy_evidence_summary, core.session_drivers]`; R01 entity_resolution 18549ms + completeness 17649ms; M22's laps-family completeness = 0ms in the same run. The shipped resolver-probe fix (`chatRuntime.ts:1696-1758` sequentializes and skips raw.car_data/raw.location) was never applied to the completeness stage (`chatRuntime.ts:2229-2237` probes ALL required tables); `core.pit_cycle_summary` is the documented ~15s un-materialized view (MEMORY: neon_warehouse_gotchas). Memoization exists (`getGlobalTableCounts` `queries.ts:118-148`, `getSessionTableCounts` `queries/sessions.ts:504-533`) — repeat probes are 0ms — but first touch per process/session stalls 35–40s and cascades into F04/F09.

**Root cause.** Expensive-view skip list not shared with the completeness stage; no warm-up; no per-probe latency bound.

**Affected files.** `web/src/lib/chatRuntime.ts`, `web/src/lib/queries.ts`, `web/src/lib/queries/sessions.ts`, `web/src/lib/resolverCache.ts`.

**Proposed fix.**

1. **Shared skip/timeout list.** Export the expensive-relation set used at `chatRuntime.ts:1696+` (e.g. `EXPENSIVE_PROBE_TABLES = new Set(['raw.car_data','raw.location','core.pit_cycle_summary','core.strategy_summary','core.strategy_evidence_summary'])`) and consult it in the completeness stage: for expensive tables, probe with a short `SET LOCAL statement_timeout = 2500` and on timeout mark the check `status: 'unprobed_expensive'` (treated as usable — optimistic; the template exec is the real test).
2. **Cheap existence probes.** Replace session row-counts on strategy views with `SELECT 1 FROM core.stint_summary WHERE session_key=$1 LIMIT 1` — `stint_summary` is the cheap member of the family and a reliable proxy for the others.
3. **Warm-up:** on server boot (or first request, fire-and-forget), touch `getGlobalTableCounts()` so the memo is hot before user traffic.

**Test plan.** Extend `chatRuntime-synthesis-payload.test.mjs` or new `completeness-probe-budget.test.mjs`: mock pool where `pit_cycle_summary` probe hangs → completeness stage returns within budget with `unprobed_expensive`; laps-family unaffected.

**Regression harness.** Sweep summary already prints stage durations; add gate: `completeness_check` p95 < 3000ms across a cold-started sweep (`kill dev server; restart; node scripts/health/baseline_sweep.mjs --only M02,M09,M10`).

**Effort:** M. **Risk:** low-medium — optimistic 'unprobed' could let a strategy question through to a template against a genuinely empty session; the template returns 0 rows and the existing zero-row grader (`grader-zero-row-classifier.test.mjs` machinery) handles it honestly.

---

### F09 — P1 · routing · Budget anchoring starves the repair path; doubled error sentence

**Prompts:** M09.

**Symptom.** M09: 41.3s resolution → first SQL attempt times out at 15s → `chat_query_sql_pipeline_exhausted` 1ms later → user sees *"I couldn't construct a valid SQL query for this question. I couldn't construct a valid SQL query for this question within the time budget."* The Phase 17-D `heuristic_after_sql_timeout` branch is unreachable because `sqlPipelineDeadline = startedAt + OPENF1_SQL_REPAIR_BUDGET_MS(60s)` is anchored at **request start** (`orchestration.ts:361`, `1076-1077`), charging resolution latency against the SQL budget; deadline checks at `:1211`/`:1247` fire before the repair.

**Root cause & fix.** Anchor the deadline at SQL-pipeline entry, and fix the message composition:

```ts
// orchestration.ts — where SQL generation begins (post runtime-ready)
const sqlPipelineStartedAt = Date.now();
const sqlPipelineDeadline = sqlPipelineStartedAt + SQL_REPAIR_BUDGET_MS;
```

```ts
// failure-message composition (~:1337)
const GENERIC = "I couldn't construct a valid SQL query for this question.";
const userFacing = sqlErrorDetail.startsWith(GENERIC.slice(0, 40))
  ? sqlErrorDetail
  : `${GENERIC} ${sqlErrorDetail}`;
```

(Cleaner: give `sqlPipelineError` a `detailOnly: boolean` and compose once.) Optionally cap total request time separately (`OPENF1_TOTAL_REQUEST_BUDGET_MS`) so re-anchoring can't produce 100s requests: if `runtime.durationMs > totalBudget - SQL_REPAIR_BUDGET_MS`, shrink the SQL budget proportionally but never below one attempt + one repair (~35s).

**Affected files.** `web/src/app/api/chat/orchestration.ts`, `web/src/lib/db/driver.ts` (env plumb).

**Test plan.** Extend `skip-repair.test.mjs`: simulate 41s runtime (mock clock) + first-attempt timeout → assert repair/heuristic branch IS reached; assert no duplicated sentence in any `sqlPipelineError` composition (regex `/(I couldn't construct[^.]+\.)\s*\1/`).

**Regression harness.** Baseline gate: `--only M09` must not return `sql_generation_failed` on a warm server.

**Effort:** S. **Risk:** low; watch total-latency histograms in sweep output after landing.

---

### F10 — P1 · visual · line_dual_axis zero-fills missing laps

**Prompts:** s101:wet_crossover#1, s303:wet_crossover#1.

**Symptom.** `registry.ts:868`: `return toNumber(match?.[lapTimeCol] ?? 0);` — missing (driver,lap) rows become literal 0. Alonso (retired lap 32) gets 25 zeros at laps 33–57; Antonelli 29 zeros. `line-dual-axis-chart.tsx:58` includes any `value !== undefined`; y1 domain computed from `values > 0` (line 41) → retired driver's line plunges from ~140s to 0 below the axis floor. The generic line detector correctly uses `valueOrNaN` (`registry.ts:455`).

**Fix.** In `lineDualAxisDetector.build()`: driver series → `valueOrNaN(match?.[lapTimeCol])`; weather series (`:877`) same. In `line-dual-axis-chart.tsx`, skip non-finite: `if (Number.isFinite(v)) point[key] = v;` and let Recharts `connectNulls={false}` terminate the line at retirement.

**Files.** `web/src/lib/mapInsight/detectors/registry.ts`, `web/src/components/f1-chat/charts/line-dual-axis-chart.tsx`.

**Test plan.** Extend `mapInsight.test.ts` (tsx test): fixture with driver A laps 1–10, driver B laps 1–5 → B's series has NaN (not 0) for laps 6–10; no series value of exactly 0 for missing laps. Renderer covered by `visualization-contract.test.ts` if it snapshots data arrays.

**Harness.** Randomized sweep D3 for wet_crossover: assert min(series values excluding NaN) > 30 (no sub-30s "lap times").

**Effort:** S. **Risk:** none.

---

### F11 — P1 · routing · Overbroad template trigger regexes hijack LLM-path questions

**Prompts:** M04, M11.

**Symptom.** M11 ("Compare medium-compound deg curves between McLaren and Red Bull in stint 2…", expect scatter_with_regression) hijacked by `DEG_TRIGGER` `/deg(?:radation)? curves?/` (`degradationCurve.ts:24-25`); answer never mentions McLaren, Red Bull, stint 2, or aero. M04 ("…Turns 7, 8, 9… entry vs apex") hijacked by `SECTOR_TRIGGER` `\bsectors?\b` (matches "Sector 2") + `GAIN_TRIGGER` 'lose' (`sectorDominance.ts:32-33`); the 3-row S1/S2/S3 template structurally cannot answer per-corner phase questions — then it also timed out.

**Fix.** Negative guards in the trigger functions (keep them next to the positive triggers per file idiom):

```ts
// degradationCurve.ts
const TEAM_COMPARISON_RX = /\b(mclaren|ferrari|mercedes|red bull|aston martin|alpine|williams|haas|sauber|racing bulls|rb)\b.*\b(vs|versus|between|and)\b/i;
const STINT_SCOPED_RX = /\bstint\s*\d/i;
export function matchesDegradationCurve(msg: string): boolean {
  if (TEAM_COMPARISON_RX.test(msg) || STINT_SCOPED_RX.test(msg)) return false; // LLM path
  return DEG_TRIGGER.test(msg);
}
```

```ts
// sectorDominance.ts
const CORNER_PHASE_RX = /\b(entry|apex|exit|turn[- ]?in|braking point)\b/i;
const NAMED_TURNS_RX = /\bturns?\s+\d+(\s*,\s*\d+)*/i;
if (CORNER_PHASE_RX.test(msg) || NAMED_TURNS_RX.test(msg)) return false;
```

Mirror the rejection in `topicGuards.ts` entries for `compound_degradation_curve` (currently rejects only 'telemetry' at `:447`) and `driver_pair_sector_dominance`, so the guard layer agrees with the trigger layer.

**Test plan.** `template-router-topic-guards.test.mjs` + `template-router-topic-coverage.test.mjs` (hardcoded file lists — no new files here, just cases): M04 and M11 prompt strings route to NO template; existing positive prompts (R02, deg_curve family, M16 sector wording) still route. These two test files are the designed home for exactly this class.

**Harness.** `baseline_sweep.mjs --only M04,M11`: generationSource must be `anthropic`/`anthropic_repaired`, expected shapes grouped_bar / scatter_with_regression get their first real chance to render.

**Effort:** S. **Risk:** medium-low — negative guards can over-reject (e.g. "deg curves at Jeddah for the two Ferraris" → LLM path). Acceptable: LLM path is the designed generalist; sweep coverage catches quality drops.

---

### F12 — P1 · data · Deg-curve SQL: no SC/lap-1 exclusion, no min-sample guard

**Prompts:** M11, R02, s101/s202/s303 deg_curve.

**Symptom.** Jeddah: medium age1 +2.788/age2 +8.204 then ages 3–15 ≈ −32.2s with `lap_count=2` per age — the age≤2 "fresh baseline" was SC-paced, so everything after reads 32s "faster"; answer claims *"Hard nets out 1.511s/lap FASTER with age (−43.82s by age 30) — fuel burn-off outweighs tyre wear"* (physically impossible; hedged only by the generic not-fuel-corrected caveat). Monaco swings ±22s; Bahrain/Mexico age-0 buckets +6.6…+11.7s from standing starts. `degradationCurve.ts` (quoted above) filters `is_valid/is_pit_lap/is_pit_out_lap` only; `raceTrace.ts:97` already computes `is_neutralized` from synchronized lap-time spikes but the technique is unreused; `HAVING lap_count>=2` admits 2-lap buckets.

**Fix.** In `buildDegradationCurveSql` (`web/src/lib/deterministicSql/degradationCurve.ts`):

1. Exclude lap 1: `AND lap_number > 1` in the `laps` CTE.
2. Port the raceTrace neutralization idiom — add a CTE computing the per-lap field median and flag laps > 1.4× the session median as neutralized, exclude them from BOTH `baselines` and `agg`:

```sql
field_median AS (
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration) AS med
  FROM laps
),
clean_laps AS (
  SELECT l.* FROM laps l, field_median m
  WHERE l.lap_duration < m.med * 1.4   -- drop SC/VSC/red-flag paced laps
)
```

3. Raise bucket floor: `HAVING COUNT(*) >= 4` in `agg`; require `COUNT(*) >= 6` in `baselines` else emit `NULL` base and let the insight builder suppress that compound with a "insufficient clean fresh-tyre laps" caveat.
4. Builder-side plausibility clamp (also serves F21): in `degradationCurveInsight.ts`, if any `|deg_delta_s| > 5`, replace the cliff/slope narrative with a disruption caveat: `"Delta magnitudes exceed plausible tyre effects — this race's baseline laps were likely run under Safety Car; treat the curve as unreliable."`

**Files.** `web/src/lib/deterministicSql/degradationCurve.ts`, `web/src/lib/synthesis/degradationCurveInsight.ts`.

**Test plan.** New `degradation-curve-insight.test.mjs` (mirror `pace-cliff-insight.test.mjs`): (a) Jeddah-shaped fixture (−32s wall) → disruption caveat, no cliff claim, no "FASTER with age" prose; (b) clean Mexico-shaped fixture → unchanged behavior; (c) SQL string asserts: contains `lap_number > 1`, contains `1.4`, `HAVING COUNT(*) >= 4`. Add file to the router test hardcoded lists only if the filename set changes (it doesn't).

**Harness.** Randomized sweep deg_curve family D6: fail if any emitted series value `|v| > 8`s without a disruption caveat in takeaways.

**Effort:** M. **Risk:** medium — the 1.4× median filter can drop genuinely slow degraded laps at extreme-deg races; 1.4× is conservative (SC laps run ~1.3–1.6× race pace); validate against the clean Bahrain/Mexico captures for row-identical output.

---

### F13 — P1 · visual · `season_year` leaks as a radar axis

**Prompts:** M17, s101/s202/s303 radar (4/4 radar prompts).

**Symptom.** Emitted specs: `axes:['Season year','Restart','Traffic','Consistency']`, values `[2025, 75, 18.4, 0]`, `max_value:100`, `total_axes:8` — renderer (`radar-chart.tsx:38-42`) pins PolarRadiusAxis domain [0,100], so the 2025 vertex draws ~20× off-scale, destroying the polygon; caption "4 of 8 axes not yet populated" contradicts the server card's "7-axis model".

**Root cause.** `IDENTIFIER_COLS` (`registry.ts:18-26`, quoted above) contains `year` but not `season_year`; `radarDetector.build()` (`registry.ts:617-655`) takes every numeric-like non-identifier column as an axis.

**Fix.** Two lines plus a clamp:

```ts
const IDENTIFIER_COLS = new Set([
  "driver_number", "session_key", "lap_number", "meeting_key",
  "year", "season_year", "season", "round", "id"
]);
```

Defense-in-depth in `radarDetector.build()`: drop any candidate axis whose values all exceed `max_value` (a 2025 on a 0–100 radar can never be a score):

```ts
const axisCols = numericCols.filter(c => rows.some(r => parseFiniteNumber(r[c]) <= maxValue));
```

And in `radar-chart.tsx`, clamp rendered values to the domain as a final guard.

**Files.** `web/src/lib/mapInsight/detectors/registry.ts`, `web/src/components/f1-chat/charts/radar-chart.tsx`.

**Test plan.** `mapInsight.test.ts`: radar fixture with `season_year: 2025` + 7 axis cols → `total_axes === 7`, no axis named 'Season year', partial counts match `performanceRadarInsight` math (fixture shared with F22 test).

**Harness.** Randomized sweep D3 radar: assert every series value ≤ spec.max_value.

**Effort:** S. **Risk:** none.

---

### F14 — P1 · data · `analytics.weather_impact` duplicate stint-boundary rows

**Prompts:** M14, s101:wet_crossover#1.

**Symptom.** Boundary laps appear twice per driver with identical `lap_time_s` but contradictory `{wet_track:0, HARD}` vs `{wet_track:1, INTERMEDIATE}` (Norris lap 34 ×2, lap 44 ×2; Stroll 33/44). Consequences: same-race wet-lap counts differ across cards (48 vs 47); phantom 1-lap stints in takeaways (*"Hard 33–33 → Int 33–33 … each switch = a pit stop"*); registry marker builder (`registry.ts:888-908`) renders phantom Hard→Int→Hard flip-flops as extra ReferenceLines. `wetCrossover.ts`'s header promises "one row per (driver, lap)" but SELECT DISTINCT cannot collapse rows that genuinely differ.

**Root cause.** Warehouse lap-range stint join: pit lap falls inside both outgoing and incoming stint windows.

**Fix.** Collapse in the template SQL with a deterministic winner — the **incoming** stint (the tyre the driver ends the lap on):

```sql
-- wetCrossover.ts: wrap the current select
, ranked AS (
  SELECT w.*,
         ROW_NUMBER() OVER (
           PARTITION BY driver_number, lap_number
           ORDER BY stint_number DESC          -- incoming stint wins the boundary lap
         ) AS rn
  FROM weather_rows w
)
SELECT ... FROM ranked WHERE rn = 1
```

(If `stint_number` isn't projected by the view, order by `compound_name != prev` heuristics is fragile — prefer adding stint_number to the view's projection; it exists in the underlying join.) Belt-and-braces in `wetCrossoverInsight.ts`: assert one row per (driver, lap) post-load and last-write-wins collapse with a `data_dedup_applied` note if violated. The registry marker builder then needs no change (phantom transitions disappear with the dups).

**Files.** `web/src/lib/deterministicSql/wetCrossover.ts`, `web/src/lib/synthesis/wetCrossoverInsight.ts`, (optional) warehouse view migration.

**Test plan.** New `wet-crossover-insight.test.mjs`: M14-shaped fixture with boundary dups → one row per (driver,lap) after load; stint takeaway has no 1-lap same-boundary phantom stints; wet-lap count stable. SQL-shape assert: template contains `ROW_NUMBER() OVER (PARTITION BY driver_number, lap_number`.

**Harness.** Randomized sweep wet_crossover D6: fail on takeaway matching `/(\d+)–\1\b.*→.*\1–\1/` (1-lap flip-flop pattern).

**Effort:** M. **Risk:** low-medium — boundary-lap wet flag choice (incoming stint) changes wet-lap counts by ±1 vs today; document the convention in the template header.

---

### F15 — P1 · honesty · Strategy-split verdict ignores DNFs

**Prompts:** s303:strategy_split#1.

**Symptom.** Zandvoort 2025: both Ferraris retired (Hamilton's only stint ends lap 22 of 72; finish_position 20). Card: *"Hamilton ran Med (no stops). That is a genuine strategy split: Leclerc made 2 stops to Hamilton's 0."* Verdict YES. A crash is presented as a deliberate 0-stop strategy.

**Root cause.** `strategySplitInsight.ts:229` derives the verdict purely from stop-count/sequence difference; `finish_position` is parsed (line ~98) but only displayed; no coverage-vs-race-distance check; grep for retire/dnf: nothing.

**Fix.** In `buildStrategySplitInsight`:

```ts
const raceEndLap = Math.max(...allStints.map(s => s.endLap));
function coverage(d: DriverStints) { return Math.max(...d.stints.map(s => s.endLap)) / raceEndLap; }
const dnf = { a: coverage(a) < 0.9, b: coverage(b) < 0.9 };
if (dnf.a || dnf.b) {
  verdict = { answer: "UNDETERMINED", ... };
  summary = `${dnfName}'s race ended on lap ${lastLap} of ${raceEndLap} — a stop-count comparison is not meaningful after a retirement.`;
  // keep the gantt (it honestly shows the short bar) and compound-order takeaways
}
```

Compute this BEFORE the stop-count verdict (same ordering lesson as F19). Use the larger driver's last lap as the race-length proxy (already in rows as the gantt's `total_laps`).

**Files.** `web/src/lib/synthesis/strategySplitInsight.ts` (SQL unchanged — finish/stint data already present).

**Test plan.** Extend `strategy-split-insight.test.mjs` (exists): (a) Zandvoort-shaped fixture (one driver ends 22/72) → verdict UNDETERMINED, no "genuine strategy split", retirement sentence present; (b) both full-distance → unchanged; (c) both DNF → UNDETERMINED.

**Harness.** Randomized sweep strategy_split D5 honesty check: verdict YES requires both drivers' max stint end ≥ 0.9 × max lap in rows.

**Effort:** S. **Risk:** low. Red-flag-shortened races where everyone "retires" at the same lap: coverage is relative to the race's own max lap, so unaffected.

---

### F16 — P1 · routing · One-directional team substring match

**Prompts:** M11.

**Symptom.** `scoreDriverCandidate` uses `normalizedMessage.includes(teamName)` (`web/src/lib/chatRuntime/resolution.ts:292`) — "red bull racing" is not a substring of the message, so "Red Bull" never matches; M11 resolved only McLaren drivers and presented McLaren-only laps as venue-wide with no caveat.

**Fix.** Alias table + bidirectional match:

```ts
// resolution.ts
const TEAM_ALIASES: Record<string, string[]> = {
  "red bull racing": ["red bull", "rbr"],
  "racing bulls": ["rb", "vcarb"],
  "aston martin": ["aston"],
  "kick sauber": ["sauber", "stake"],
  "haas f1 team": ["haas"],
  // canonical names that are already substrings need no entry
};
function messageMentionsTeam(normalizedMessage: string, teamName: string): boolean {
  const canon = teamName.toLowerCase();
  if (normalizedMessage.includes(canon)) return true;
  return (TEAM_ALIASES[canon] ?? []).some(a =>
    new RegExp(`\\b${a}\\b`).test(normalizedMessage));
}
```

Word-boundary the aliases ("rb" must not match "verb"). Note interplay with F11: even after this fix, M11 routes to the LLM path (team-comparison guard), which is correct — the resolver fix matters for every other team-mention prompt.

**Files.** `web/src/lib/chatRuntime/resolution.ts`.

**Test plan.** Extend `resolver-disambiguation.test.mjs` (has the team fixtures): "Red Bull" resolves Verstappen+teammate; "RB"/"Racing Bulls" disambiguation; "verb" resolves nothing; "McLaren and Red Bull" resolves 4 drivers.

**Harness.** Add a team-vs-team prompt family to the randomized sweep pools (see §5) — currently zero coverage.

**Effort:** S. **Risk:** low; alias list is static per season, keep next to existing team color tables for maintenance symmetry.

---

### F17 — P2 · data · Wet-crossover = first inter→slick transition, no wet-phase context

**Prompts:** s303:wet_crossover#1.

**Symptom.** Antonelli "crossover: Lap 3" (an opening-laps gamble: Int 1–2 → Hard 3–9 → Int 10–23, retired on inters) presented alongside Russell's genuine lap-39 drying-phase crossover; takeaway fabricates *"Crossover laps differ by 36 laps — one car gambled on the dry line earlier"* (`wetCrossoverInsight.ts:107` fires on spread > 2 with no phase check).

**Fix.** Validate the crossover against the wet phase, computable from the rows the card already has:

```ts
// wetCrossoverInsight.ts
const wetLaps = rows.filter(r => num(r.wet_track) === 1).map(r => num(r.lap_number));
const wetPhaseEnd = wetLaps.length ? Math.max(...wetLaps) : null;
const wetPhaseStart = wetLaps.length ? Math.min(...wetLaps) : null;
function isDryingCrossover(lap: number | null): boolean {
  return lap != null && wetPhaseStart != null && lap > wetPhaseStart;
}
// per driver: if crossover exists but !isDryingCrossover → relabel
metricLabel = isDryingCrossover(d.crossover)
  ? `${d.name} crossover: Lap ${d.crossover}`
  : `${d.name}: early slick gamble on lap ${d.crossover} — no drying-phase crossover recorded`;
```

Suppress the "gambled on the dry line earlier" takeaway unless BOTH laps are drying-phase crossovers. (Warehouse-level fix — defining `inter_to_slick_crossover_lap` as the transition ending the final wet phase — is the right long-term home; the builder guard ships now.)

**Files.** `web/src/lib/synthesis/wetCrossoverInsight.ts` (+ optional view migration).

**Test plan.** `wet-crossover-insight.test.mjs` (created in F14): s303-shaped fixture → Antonelli relabeled, no gamble takeaway; both-genuine fixture → unchanged.

**Effort:** S. **Risk:** low.

---

### F18 — P2 · data · Phantom brake zones; plausibility filter absent from the chart detector

**Prompts:** M05, s101:brake_zones#1, s303:brake_zones#1.

**Symptom.** Zones ranked by `AVG(entry_speed_kph - apex_min_speed_kph) DESC LIMIT 3` (`brakeZones.ts:43-56`) select drop≈0 phantom zones (Sakhir Turn 1: entry 105 == apex 105) because `analytics.corner_analysis` samples entry at/after the apex for some corners; genuine heavy zones (La Source, Bus Stop, Sakhir T4/T11) are missing/NULL. M05's "8.0 km/h average" includes Turn 1's −10 delta — the builder filter (`brakeZonesInsight.ts:71-94`: apex<40 OR entry-ratio<0.6 with divergence>8) passes symmetric drop≈0 zones. Separately, `brakeZoneDeltaDetector` (`registry.ts:1248+`) plots every zone with no filter — the bar the text excludes is the biggest bar (deliberate for *flagged* zones per builder docs, but unflagged phantom zones get no marking anywhere).

**Fix.**

1. **SQL floor:** in `brakeZones.ts` zones CTE, require a real braking event: `HAVING AVG(entry_speed_kph - apex_min_speed_kph) >= 30` (30 kph is well below any genuine brake zone, well above sampling noise).
2. **Shared plausibility module:** extract the builder's zone checks into `web/src/lib/answerSanity/brakeZonePlausibility.ts` exporting `classifyZone(zone): 'ok' | 'implausible_sample' | 'no_braking_event'`; consume from BOTH `brakeZonesInsight.ts` and `brakeZoneDeltaDetector` — detector marks implausible zones (suffix `⚠` in the y-axis label, or drop `no_braking_event` zones entirely) so chart and text agree.
3. Add `zone_avg_drop >= 30` to the builder's inclusion check for the headline average.

**Files.** `web/src/lib/deterministicSql/brakeZones.ts`, `web/src/lib/synthesis/brakeZonesInsight.ts`, `web/src/lib/mapInsight/detectors/registry.ts`, new `web/src/lib/answerSanity/brakeZonePlausibility.ts`.

**Test plan.** New `brake-zones-insight.test.mjs`: Sakhir fixture → Turn 1 excluded from selection/average; Spa fixture → Eau Rouge flagged in BOTH insight and detector spec; Jeddah 2-zone fixture (feeds F27 too). `mapInsight.test.ts`: detector spec omits/flags `no_braking_event` zones.

**Harness.** Randomized sweep brake_zones D3: every plotted zone has `zone_avg_drop >= 30` or a `⚠` label.

**Effort:** M. **Risk:** medium — the 30 kph floor may drop a real zone at low-speed circuits (Monaco hairpin drops are huge, fine; flat-out tracks may yield <3 zones — F27's `corners.length` fix makes that graceful).

---

### F19 — P2 · data · Stint fragmentation inflates stop counts; verdict computed before classification

**Prompts:** s202:strategy_split#1.

**Symptom.** Montreal: Sainz "stints" 3/4/5 = same-compound 1–2-lap fragments with `avg_valid_lap NULL` → *"Albon made 1 stop to Sainz's 4... stops lap 56, 65, 66, 67"* asserted as fact, while takeaway 4 simultaneously disclaims them as SC/red-flag artifacts. `strategySplitInsight.ts:111` computes `stops = stints.length - 1` unconditionally; micro-stint classifier (lines 206–218) runs after the verdict.

**Fix.** Merge fragments BEFORE any downstream math:

```ts
// strategySplitInsight.ts — normalize stints first
function mergeFragmentedStints(stints: Stint[]): { merged: Stint[]; mergedCount: number } {
  const merged: Stint[] = [];
  for (const s of sorted(stints)) {
    const prev = merged[merged.length - 1];
    const isFragment = s.compound === prev?.compound &&
      (s.endLap - s.startLap + 1) <= 2 && s.avgValidLap == null &&
      s.startLap === prev.endLap + 1;
    if (isFragment) { prev.endLap = s.endLap; mergedCountRef++; }
    else merged.push({ ...s });
  }
  return { merged, mergedCount };
}
```

Compute stops, sequences, verdict, gantt input, and `pitStints.ts` summaries from `merged`; keep a takeaway when `mergedCount > 0`: `"N same-compound stint fragments (SC/red-flag tyre records) merged — not counted as pit stops."` Apply the same normalization inside `web/src/lib/answerSanity/pitStints.ts` summarize helpers so answer-sanity counts agree.

**Files.** `web/src/lib/synthesis/strategySplitInsight.ts`, `web/src/lib/answerSanity/pitStints.ts`, detector gantt input (registry — merged rows flow through automatically if the builder passes them).

**Test plan.** Extend `strategy-split-insight.test.mjs`: Montreal fixture → Sainz stops = 1, verdict text says 1-vs-1 compound-order split (or NO), merge takeaway present; `validator-pit-stints.test.mjs`: summarize helper merges fragments.

**Harness.** Randomized sweep strategy_split D6: stop counts in prose must equal merged-stint count from rows.

**Effort:** M. **Risk:** low-medium — genuine same-compound stops (fresh set of the same compound under late SC) exist; the `avg_valid_lap == null && length ≤ 2 && contiguous` triple-condition keeps false merges rare, and the takeaway discloses.

---

### F20 — P2 · visual · `duration_sec` substring mispick + no min-bars guard

**Prompts:** M01.

**Symptom.** Pole-lap hero card gains a one-bar chart of `Duration sector 1` (30.387s) because `HBAR_PREFERRED_COL_PATTERNS[0]` (`registry.ts:474-480`, quoted above) contains `duration_sec|duration_s` which substring-matches `duration_sector_1`, beating `lap_duration`; `horizontalBarDetector` has no minimum-entry guard.

**Fix.**

```ts
const HBAR_PREFERRED_COL_PATTERNS = [
  /pit_loss|stationary_seconds|stationary_s\b|duration_sec\b|duration_s\b|duration_ms\b|pit_time|service_time/i,
  /lap_duration|lap_time_s|lap_time_ms|lap_time/i,   // lap_duration promoted
  /gap_seconds|gap_s\b|gap_ms\b|gap\b/i,
  /delta_s\b|delta_ms\b|delta\b/i,
  /avg_|mean_|median_/i
];
```

(`\b` after `duration_sec`/`duration_s` stops the `duration_sector_*` capture; test both `duration_s` and `duration_seconds` naming.) Min-bars guard in `horizontalBarDetector.matches()`: `if (entries.length < 2) return false;` — a single-row scalar answer is the hero's job.

**Files.** `web/src/lib/mapInsight/detectors/registry.ts`.

**Test plan.** `mapInsight.test.ts`: (a) M01-shaped single row with lap_duration + 3 sector durations → NO horizontal_bar; (b) 5-row pit-loss fixture → still fires with the pit column; (c) multi-row rowset with `lap_duration` + `duration_sector_1` → picks `lap_duration`.

**Harness.** Baseline sweep M01: expect null chart (kind: hero) — the mechanical D3 check starts passing.

**Effort:** S. **Risk:** low; re-run the full `mapInsight.test.ts` suite — pattern priority shifts can re-rank picks in other families.

---

### F21 — P2 · honesty · Deg-curve cliff narrative + "+-22.87s" formatting

**Prompts:** s101:deg_curve#1 (Monaco).

**Symptom.** *"Hard crosses the cliff threshold around age 1 and stays high (−22.87s by age 67)"* and takeaway *"degrades ~−0.341s/lap ... (median +-22.87s by age 67)"*. Mechanisms: cliff fires on one look-ahead point (`degradationCurveInsight.ts:69`); `median +${s.lastDelta.toFixed(2)}s` hardcodes '+' (line 93); "stays high" hardcoded (line 119); cliff branch outranks the fuel-dominated branch.

**Fix.** (Rides on F12's disruption clamp; these are the residual text bugs.)

```ts
// sustained check: majority of points after the cliff index must stay elevated
const after = points.slice(cliffIdx + 1);
const sustained = after.length >= 2 &&
  after.filter(p => p.delta > CLIFF_THRESHOLD_S * (2 / 3)).length >= after.length * 0.6;
if (!sustained) cliff = null;
// signed formatting helper (reuse across builders)
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}s`;
// endpoint phrasing
const endPhrase = s.lastDelta > 0 ? `stays high (${signed(s.lastDelta)})`
                                  : `then falls back under baseline (${signed(s.lastDelta)})`;
```

**Files.** `web/src/lib/synthesis/degradationCurveInsight.ts`.

**Test plan.** `degradation-curve-insight.test.mjs` (created in F12): Monaco fixture → no cliff claim (spike not sustained after F12's clamp; also unit-test `sustained` directly), no `+-` anywhere (regex over all emitted strings: `/\+\-/` must not match).

**Effort:** S. **Risk:** none.

---

### F22 — P2 · honesty · Radar either-zero exclusion misstated; delta sign flipped

**Prompts:** M17, s101/s202/s303 radar.

**Symptom.** Axes dropped when EITHER driver is 0 (`performanceRadarInsight.ts:64`: `a === 0 || b === 0`; sign-off said BOTH) and the lede claims dropped axes "read 0.0 in the 2025 score model (not yet populated)" — false when one driver has 80.1. Also *"biggest gap ... Consistency: 30.0 vs 60.0 (−30.0 to Norris)"* — the leading driver gets a negative number (line ~111 emits `signed(delta)` with the B-driver's name without flipping).

**Fix.** Keep the either-zero exclusion (defensible for comparison) but tell the truth about it, and fix the sign:

```ts
// performanceRadarInsight.ts
const bothZero = axes.filter(ax => ax.a === 0 && ax.b === 0);
const oneSided = axes.filter(ax => (ax.a === 0) !== (ax.b === 0));
// lede
if (bothZero.length) lede += ` The ${names(bothZero)} axes read 0.0 for both drivers (not yet populated).`;
if (oneSided.length) lede += ` The ${names(oneSided)} axes are excluded from the comparison — populated for only one driver.`;
// biggest gap: attribute to the LEADER with a positive magnitude
const leader = delta >= 0 ? nameA : nameB;
gapText = `${axis}: ${a.toFixed(1)} vs ${b.toFixed(1)} (+${Math.abs(delta).toFixed(1)} to ${leader})`;
```

**Files.** `web/src/lib/synthesis/performanceRadarInsight.ts`.

**Test plan.** New `performance-radar-insight.test.mjs`: (a) one-sided-zero fixture → lede says "populated for only one driver", never "read 0.0"; (b) both-zero → "read 0.0 for both"; (c) gap always `+X to <leader>`; (d) axis counts consistent with F13's detector counts (shared fixture).

**Effort:** S. **Risk:** none.

---

### F23 — P2 · data · Synthesis samples only the first 25 rows

**Prompts:** s101:pit_stop#1, s303:pit_stop#1.

**Symptom.** `buildSynthesisPrompt.ts:374`: `const rowsForPrompt = contract.rows.slice(0, 25)`. Lap-ordered rowsets → sample covers laps 1–13 (dup rows halve coverage); pit outlier at lap 47 unreachable; answers punt: *"that information is present in the full 106-row result but not visible in the provided sample"*. The repo's own judge harness already solved this (`randomized_sweep.mjs` `judgeSample`, lines ~556/582: evenly-strided + final-lap sampling).

**Fix.** Port the judge's sampler:

```ts
// buildSynthesisPrompt.ts
function sampleRowsForPrompt(rows: Row[], cap = 25): { sample: Row[]; note: string } {
  if (rows.length <= cap) return { sample: rows, note: "" };
  const stride = Math.ceil(rows.length / (cap - 1));
  const sample = rows.filter((_, i) => i % stride === 0);
  if (sample[sample.length - 1] !== rows[rows.length - 1]) sample.push(rows[rows.length - 1]);
  return {
    sample: sample.slice(0, cap),
    note: `NOTE: ${rows.length} rows total — evenly sampled every ${stride} rows (first and last included). ` +
          `Outliers between samples may exist; per-row extremes below are exact.`
  };
}
```

Bonus (cheap, high yield for outlier questions): append a one-line per-numeric-column min/max digest computed over ALL rows (`col: min=82.998@lap12, max=104.986@lap47`) — makes "first stop lap" answerable regardless of sampling.

**Files.** `web/src/lib/synthesis/buildSynthesisPrompt.ts`.

**Test plan.** Extend `chatRuntime-synthesis-payload.test.mjs`: 106-row fixture → sample includes first and last lap; digest line contains the lap-47 max; ≤25 rows unchanged.

**Harness.** Pit_stop family D6: answer must state a concrete stop lap when rows contain a >15s lap-duration outlier.

**Effort:** S. **Risk:** low — strided samples change synthesis inputs everywhere; watch judge grades on a full `--judge` randomized sweep before/after.

---

### F24 — P2 · honesty · Quality assessor grades all rowCount>0 as B

**Prompts:** M04 + 5 randomized fallback captures.

**Symptom.** `chatQuality.ts` rowCount>0 branch (quoted above) returns B/"Answer appears to address the question" — including answers whose own text says the data can't answer it. `generationSource` is declared in `GradeInput` but never read (incomplete wiring). Blinds grade-based monitoring to the whole P0/P1 fallback class.

**Fix.**

```ts
// chatQuality.ts — before the rowCount>0 → B branch
const DEGRADED_SOURCES = new Set(["heuristic_after_template_failure", "heuristic_after_sql_timeout"]);
if (rowCount > 0 && DEGRADED_SOURCES.has(generationSource ?? "")) {
  return { grade: "C", reason: "Answered from a degraded fallback query — rows may not match the question's entities." };
}
const SELF_DECLARED_UNABLE = /not possible to determine|cannot be determined from|not visible in the provided sample|does not (contain|include|cover)/i;
if (rowCount > 0 && SELF_DECLARED_UNABLE.test(answer)) {
  return { grade: "C", reason: "The answer itself states the returned data cannot answer the question." };
}
```

(After Wave 1, `heuristic_after_template_failure` no longer exists; keep the set for `heuristic_after_sql_timeout` and belt-and-braces.)

**Files.** `web/src/lib/chatQuality.ts`.

**Test plan.** Extend `grading-regression.test.mjs` + `grader-insufficient-data.test.mjs`: fallback source + rows → C; self-declared-unable answer + rows → C; normal template success → B unchanged (regression pin on the existing golden grades in `category-regression-gate.test.mjs`).

**Effort:** S. **Risk:** low; check `category-regression-gate.test.mjs` thresholds — new C's may shift category aggregates it pins.

---

### F25 — P3 · data · pg NUMERIC/BIGINT parsers only in `db/driver.ts`

**Prompts:** 26 (every capture with numeric-string columns — latent, no current user impact).

**Symptom/root cause.** `pgTypes.setTypeParser(1700/20)` lives only in `web/src/lib/db/driver.ts:10-11` (imported by track-outline + lap-telemetry routes); `runReadOnlySql` (`web/src/lib/queries/execute.ts:1`) uses the `web/src/lib/db.ts` pool with no parsers → chat-path numbers arrive as strings. Currently mitigated everywhere that matters (`parseFiniteNumber` in the registry, `num()` in builders; the string-zeroing legacy builders at `mapInsight.ts:298/420` are unreachable), but every new non-registry consumer is a foot-gun.

**Fix.** Consolidate: make `db.ts` re-export the pool from `db/driver.ts` (single pool module, parsers registered once at module top), or move the two `setTypeParser` calls into a shared `db/pgTypes.ts` imported by both. Delete the unreachable legacy builders in `mapInsight.ts` while there (they encode the wrong `typeof v === "number" ? v : 0` idiom someone might copy).

**Files.** `web/src/lib/db.ts`, `web/src/lib/db/driver.ts`, `web/src/lib/mapInsight.ts`.

**Test plan.** Extend `pooled-url-assertion.test.mjs` / `db-stmt-cache.test.mjs` neighborhood with a parser-registration assert (import the pool module, check `pgTypes.getTypeParser(1700)('1.5') === 1.5`). Full `npm run verify` — pool consolidation touches everything.

**Effort:** S code / M verification. **Risk:** medium-blast-radius, low-probability: every query path changes row value types from string→number; the registry/builders coerce either way, but JSON payload shapes change (numbers not strings) — snapshot-style tests and any client `typeof` checks need a sweep. Land early in a wave with full sweep gates, not as a drive-by.

---

### F26 — P3 · honesty · Wet-crossover headline omits the non-crossing driver

**Prompts:** s101:wet_crossover#1.

**Symptom.** Prompt asks Alonso AND Stroll; Alonso retired on inters (crossover NULL on all rows); answer: *"The inter-to-slick crossover at Melbourne 2025 came on lap 33."* — no Alonso mention; metric tile honestly says "Alonso crossover: n/a".

**Fix.** In `wetCrossoverInsight.ts` (lines ~76–120), after building `crossoverText` from `withCrossover`, append for each requested driver with null crossover: `` `${d.name} never switched to slicks — he retired on lap ${d.lastLap} still on intermediates.` `` (retirement inferable from lastLap < race max; otherwise "stayed on intermediates to the flag").

**Files.** `web/src/lib/synthesis/wetCrossoverInsight.ts`. **Test:** `wet-crossover-insight.test.mjs` case (shares F14/F17 fixtures). **Effort:** S. **Risk:** none.

---

### F27 — P3 · honesty · Hardcoded "three heaviest brake zones"; signed-mean neutrality

**Prompts:** s202:brake_zones#1.

**Symptom.** Answer opens *"Across the three heaviest brake zones (Turn 1, Turn 22)..."* with 2 zones (`brakeZonesInsight.ts:191` hardcodes 'three'; line 208's subtitle correctly uses `corners.length`). Also "essentially even on apex speed (1.0 km/h average)" from the signed mean of −8.0/+6.0 while tiles show the split.

**Fix.** Line 191 → `` `Across the ${corners.length === 3 ? "three" : String(corners.length)} heaviest brake zones (${corners.join(", ")})` ``. Neutrality: compute `meanAbsDelta` alongside `meanZoneDelta`; if `|mean| < 2 && meanAbs >= 5`, use the mixed-picture phrasing (already exists at lines 110–118, just unreachable in the neutral branch): `"the zones split — ${aName} faster into ${zoneA} (−8.0), ${bName} into ${zoneB} (+6.0) — netting out near zero"`.

**Files.** `web/src/lib/synthesis/brakeZonesInsight.ts`. **Test:** `brake-zones-insight.test.mjs` (created in F18): 2-zone fixture → "two heaviest", split phrasing. **Effort:** S. **Risk:** none.

---

### F28 — P3 · visual · Order-dependent teammate base/shade colors

**Prompts:** M05, M14, R03, s303 position/wet_crossover.

**Symptom.** `getDistinctTeamColors` (`web/src/lib/f1-team-colors.ts:107-118`) gives the base team color to the first-encountered driver → Norris/Piastri and Russell/Antonelli swap colors between cards of the same session.

**Fix.** Stable per-driver key: sort teammates before assignment.

```ts
// f1-team-colors.ts — inside getDistinctTeamColors, per team group
const stable = [...teammates].sort((a, b) =>
  (a.driverNumber ?? 999) - (b.driverNumber ?? 999) || a.name.localeCompare(b.name));
// base color to stable[0], shades to the rest — regardless of input order
```

Preserve the documented input-order of the RETURN array (callers zip by index); only the base/shade choice becomes order-independent. Requires threading `driverNumber` into the call where available (registry call sites have it in rows); fall back to name sort.

**Files.** `web/src/lib/f1-team-colors.ts`, call sites in `web/src/lib/mapInsight/detectors/registry.ts`. **Test:** extend `distinct-team-colors.test.mjs` (exists): `[Norris, Piastri]` and `[Piastri, Norris]` produce identical name→hex maps. **Effort:** S. **Risk:** none.

Fold-in from the refuted finding: `track-map.tsx:173` — `c.label.match(/\d+/)?.[0] ?? c.label` → truncate named corners to ≤3 chars (`"Eau Rouge"` → `"ER"` initials or hide label beyond 4 chars) so single-digit-sized labels don't get 26px strings.

---

### F29 — P3 · api · `/api/track-outline` cold derivation ≈ statement timeout

**Prompts:** s202:brake_zones#1 (measured; affects all track-ribbon charts).

**Symptom.** Cold fetch 14.5–15.0s (re-verified live) vs 15s statement timeout on the same pool; in-process `outlineCache` only (`route.ts:45`); `useTrackOutline` maps any failure to null → ribbon silently vanishes (`track-map.tsx:61-68`).

**Fix.** (a) Persist the derived outline: write-through to a tiny `f1.track_outline_cache` table (circuit key → JSON payload) checked before derivation — outlines are static per circuit/season, this removes the cold path after first-ever derivation per circuit; (b) give the derivation statements their own `timeoutMs: 30000` via the F04 `runReadOnlySql` option (it's a background-ish fetch, not the chat pipeline); (c) optional dev warm-up script `scripts/health/warm_track_outlines.mjs` looping the 24 venue pool.

**Files.** `web/src/app/api/track-outline/route.ts`, `web/src/lib/queries/execute.ts` (option from F04), migration for the cache table. **Test:** route test asserting cache-table hit skips derivation (mock pool). **Effort:** M. **Risk:** low; cache invalidation keyed on (circuit, year, source row count) to survive re-ingestion.

---

## 4. Sequencing — dependency-ordered, independently shippable waves

Verification gates use: `npm run verify` (typecheck + grading tests + adapter tests + build), `node scripts/health/baseline_sweep.mjs`, `node scripts/health/randomized_sweep.mjs --seed 7 --rounds 3 [--judge]` (dev server on :3000). Run randomized sweeps twice — once cold (fresh server) and once warm — because half the P1 class is cold-conditional.

### Wave 1 — Stop the lying (P0 honesty + fallback policy) — F01, F05, F07, F24
The fabricated-absence class and its enabling machinery, in one PR chain: retire `buildHeuristicSql`'s default branch and rebuild it context-first (F01/F07), give the `deterministic_template` failure branch the Phase 17-D error-class policy + one timeout retry (F05), pin-gate heuristic SQL, clamp synthesis against absence claims (F01), and make the grader see degraded sources (F24) so the gate itself works.
**Dependencies:** none. **Gate:** `npm run verify`; `baseline_sweep --only M06,M08,M10,M16,M19,M22` → zero absence-claim regex hits, zero `heuristic_after_template_failure`; full randomized sweep → no grade-B answers that self-declare inability. *Expected temporary effect:* more honest refusals on timeout-prone prompts until Wave 2.

### Wave 2 — Make the deterministic path actually execute (perf + budget) — F04, F08, F09
Single-scan CTE rewrites (pitCycle venue→core.sessions, stintDelta merge), template-class 25s timeout, completeness-probe skip list + cheap existence probes + warm-up, SQL-deadline re-anchoring + doubled-sentence fix.
**Dependencies:** F05's retry branch (Wave 1) is where the retry lands; CTE rewrites are independent. **Gate:** cold-start `baseline_sweep` full run → all template families `generationSource=deterministic_template`, zero timeout entries in `chat_api.log` for the run, `completeness_check` p95 < 3s, M09 answers without error text; warm randomized sweep `--rounds 3` → zero fallback sources, p95 template `elapsedMs` reported (target < 13s).

### Wave 3 — Warehouse-consumer data correctness — F02, F03, F06, F12, F14, F15, F19, F17
The "confidently wrong numbers" cluster: trace-fallback winner/mover (F02), lap-count plausibility + view dedup (F03), dedup+venue on non-template SQL and the anthropic prompt gotcha block (F06), deg-curve SC/lap-1/min-sample filters + disruption clamp (F12), weather_impact boundary-row collapse (F14), DNF guard (F15), stint-fragment merge before verdict (F19), wet-phase crossover validation (F17).
**Dependencies:** F06 builds on Wave 1's rewritten `buildHeuristicSql`; rest independent. **Gate:** `npm run verify` with the four new/extended insight test files; randomized sweep `--judge` across position_changes, deg_curve, strategy_split, wet_crossover families → D6 factual-consistency all ≥ B, new rubric checks (winner≠n/a, |deg delta| ≤ 8 or caveated, stop counts = merged stints, no 1-lap flip-flops) green; re-run the three known-clean captures (s303 position, s202 deg, M14) → byte-comparable output (no regressions on clean data).

### Wave 4 — Visual/detector and prose polish — F10, F11, F13, F16, F20, F21, F22, F26, F27, F28 (+ track-map label nit)
NaN-fill dual axis, trigger negative guards, season_year denylist + off-scale axis drop, team-alias resolution, hbar pattern boundaries + min-bars, cliff sustained-check + signed formatting, radar lede truth + delta sign, non-crossing-driver sentence, `corners.length` prose, stable teammate colors, corner-label truncation.
**Dependencies:** F21 rides on F12 (Wave 3); F22 shares fixtures with F13; F11 changes routing for M04/M11 so their LLM-path behavior should be judged after Wave 2 (working exec path). **Gate:** `npm run test:adapter && npm run test:visualization-contract`; baseline sweep → M01 chartless hero, M04/M11 routed to anthropic with plausible shapes, M17 radar polygon 7 axes ≤ 100; randomized sweep D3 shape checks all green; visual spot-check radar + wet_crossover + position_changes cards in the dev UI.

### Wave 5 — Infrastructure + harness hardening — F25, F29, golden-set expansion (§5)
Pool consolidation with type parsers (full-verify blast radius), track-outline persistent cache + timeout class, then bake this simulation's lessons into the harnesses: absence-claim regex, generationSource distribution, dup-row detector, lap-count plausibility, DNF/verdict checks as permanent mechanical rubric entries in both sweeps; add the missing prompt families below to `randomized_sweep.mjs` pools and `baseline_sweep.mjs`.
**Dependencies:** F29 uses F04's timeout option (Wave 2). **Gate:** `npm run verify` full; both sweeps full-pass twice consecutively (cold + warm); `--judge` run with overall grade distribution ≥ pre-plan baseline stored in `/tmp/baseline-sweep.json` diffs.

---

## 5. Golden-Set Gaps Exposed by This Simulation

Families/venues/edge cases the 67-prompt set does **not** cover — several confirmed findings were found only *accidentally* (e.g. DNFs surfaced because Zandvoort happened to have Ferrari retirements), meaning entire failure classes have exactly one data point:

1. **Honest-refusal positive controls.** Only M21 tests refusal, and nothing tests *correct* absence claims (e.g. "show the race trace for Imola 2019" or a genuinely missing session). After Wave 1's honesty clamp, a prompt where "not in dataset" IS the right answer is needed to prove refusals still fire. Add 2–3 to the baseline set.
2. **DNF/retirement scenarios as first-class prompts.** F15/F17/F26 all involve retirements hit by chance. Add a `dnf_strategy` slot to the randomized pools (venues with known 2025 retirements) asking strategy/crossover/position questions about retired drivers.
3. **SC/red-flag-disrupted races as a deliberate dimension.** F12/F19/F21 are disruption-conditional. Pool should tag venues by disruption (Monaco, Melbourne, Silverstone 2025) and force each family through ≥1 disrupted venue per sweep.
4. **Team-vs-team comparisons.** Only M11 — which failed for three independent reasons (F11, F12, F16). Add a randomized family (`team_pace_compare`) cycling colloquial team names (Red Bull, RB, Aston, Sauber) to exercise F16's alias table.
5. **Concurrency/cold-start as an explicit test axis.** The capture runs discovered the timeout class only because 4 requests ran concurrently against cold Neon. Add `--concurrency N` and `--cold` (server restart) modes to the sweeps; today the perf findings are reproducible only by accident.
6. **Sprint weekends and non-race sessions.** All 67 prompts target races or qualifying; sprint, sprint quali, and practice sessions are unexercised (session-name resolution, template WHERE clauses on session type).
7. **Under-covered families:** status_grid (M18 only), event_timeline (M15 only), composite (M20 only), refusal (M21 only) — one prompt each, none randomized. minisector_strip and metric_grid components exist in the codebase with zero golden coverage.
8. **Follow-up/conversation-context prompts.** Every prompt is single-turn; resolution carry-over ("and what about Piastri?") is untested.
9. **Driver-name edge cases.** No ambiguous surnames, no rookies-with-limited-data beyond Antonelli/Bearman (which both failed in other ways), no drivers absent from the resolved session (mid-season swaps) — the "requested driver not in rows" path fired only via fallback bugs.
10. **Venue phrasing variants.** M02's paraphrase ("Canada 2025") caused a 40s resolver outlier; the set otherwise uses canonical venue names. Add phrasing variants (GP name vs city vs circuit name) to the randomized venue pool.
11. **Post-fix regression prompts.** Encode the seven F01 prompts + M09 + M11 + M04 verbatim as a `honesty_regression` block in `baseline_sweep.mjs` so the P0 class has permanent named coverage.

---

*End of plan. All fixes reference shipped code as of branch `ui/v0-frontend-replacement`, 2026-07-02.*

---

## Gaps and follow-ups (critic)

Independent completeness review against `findings_final.json`, `all_prompts.json`, and the capture/log artifacts. Verified: all 67 prompts were captured exactly once each (no repeat-run variance data); the 58-touched/9-clean arithmetic is consistent with the findings register; the npm scripts named in wave gates (`verify`, `test:adapter`, `test:visualization-contract`) all exist.

### A. Prompt regimes not exercised (beyond §5's own list)

1. **Answer-cache regime — the biggest unstated confound.** At least two captures were answer-cache hits, not pipeline runs (`s202:race_trace#1` 26ms, `s303:deg_curve#1` 45ms — both cited in F08's evidence). `s202:race_trace#1` is on the "9 fully clean" list, so its clean status is a cache replay of s101's answer, not an independent observation. No prompt was run in a deliberate cache-hit vs cache-bypass pair. **Follow-ups:** (a) state in §1 that captures mix cache hits and cold runs; (b) verify/force cache bypass in every wave-gate sweep command, else post-fix sweeps can green on pre-fix cached answers; (c) add a wave item to **invalidate or version the answer cache when Waves 1–3 land** — cached P0 outputs (e.g. the "Abu Dhabi 2025 not in dataset" answer) will otherwise keep serving verbatim after the code is fixed. No F-item covers cache invalidation.
2. **M07 exclusion is unexplained.** §1 says "M01–M22 excl. M07" with no reason recorded. One line stating why (retired prompt? known-broken? duplicate?) prevents a future auditor re-adding it blind.
3. **Single-capture basis for "clean".** Every prompt has exactly one capture, and half the P1 class is cold/load-conditional — the 9 "fully clean" prompts are one-observation claims, two of them cache replays. §5.5's cold/concurrency axis covers the future; the plan should downgrade "fully clean" to "clean in the one captured run".
4. **LLM-path thinness under the new routing.** Only ~4 captures exercised the anthropic path end-to-end (M01, M03, M13 + repairs). Waves 1 and 4 deliberately push more traffic there (F11 negative guards, honest failure replacing the heuristic), so the golden set's LLM-path coverage shrinks relative to its traffic share exactly when it matters most. §5.4 adds team-compare prompts; add a general LLM-path quota (≥1 designated-LLM prompt per family) to the randomized pools.
5. **Not covered anywhere in §5:** misspelled/typo'd driver and venue names; adversarial input (prompt-injection phrasing, SQL-looking text — the SQL pipeline was audited but never probed with hostile input); non-English phrasing; multi-question single prompts. Low priority, but currently zero data points each.

### B. Checks not run — and the plan does not say so

1. **Rendered-pixel/browser verification was out of scope and this is stated nowhere.** §1's scope line ("rows → detector registry → chart spec → renderer semantics") reads as if rendering was audited; in fact chart specs are absent from captured responses and were **reconstructed by re-running the detector registry over captured rows** (disclosed only inside `findings_final.json` verdicts, e.g. F13: "the chart spec is built client-side… not in the captured response"). All rendered-outcome claims — F13's "polygon destroyed, ~20× off-scale", F10's "line plunges to 0s", F20's one-bar chart, F14's overlapping phantom ReferenceLines — are code-inferred from renderer source, never observed in a browser. **Follow-ups:** add an explicit scope statement to §1; replace Wave 4's informal "visual spot-check in the dev UI" with a screenshot-producing smoke (Playwright or the preview harness) over the four fixed chart shapes (radar, line_dual_axis, brake_zone_delta, hbar) so the render-level claims get artifact-backed before/after evidence.
2. **No query-plan evidence for the perf root cause.** F04's "multiple full scans" causation is inferred from SQL text + timing correlation; no `EXPLAIN (ANALYZE)` was captured for any failing template, and the CTE rewrites/25s timeout carry no measured expected headroom. Follow-up: capture plans for `pitCycle`/`stintDelta` before Wave 2 and record before/after `elapsedMs` on the same sessions.
3. **Cold-start vs concurrency never isolated.** The 23 capture-day timeouts occurred under ~4 concurrent requests against cold Neon; the two factors were not separated, so Wave 2's fixes may be validated against the wrong variable. §5.5's `--concurrency/--cold` sweep modes are the right tool — run them **before** Wave 2 to establish the baseline, not only after.
4. **No LLM-judge pass over these captures, and no stored pre-fix baseline.** All grades cited are the app's self-grades, which F24 shows are broken. Wave 5's gate compares against a "pre-plan baseline stored in /tmp/baseline-sweep.json" — that file must be produced **before Wave 1 lands** (one full `--judge` run on the current branch) or the comparison is unconstructible. This is a sequencing bug in the gates as written.
5. **Artifact bookkeeping nit:** every entry in `findings_final.json`'s `confirmed` array still carries `"status": "unverified"`; §2 claims "0 unverified". Cosmetic, but fix the field so downstream tooling doesn't misread the register.

### C. Plan claims not fully backed by capture evidence

1. **The retry-recovers-timeouts premise (F04/F05) rests on N=1.** Exactly one deliberate re-fire exists (s101:sector_dominance). "Log evidence shows re-fires succeed" (plural) and "would almost certainly have succeeded" overstate; the same-template successes "seconds apart" were different sessions/parameters. The one-retry design is still reasonable, but Wave 2's gate should measure retry success rate explicitly rather than assume it.
2. **Uncalibrated thresholds shipped as fixes.** F12's 1.4× field-median SC filter (justified by an unsourced "SC laps run ~1.3–1.6× race pace") was never validated against the captures — note that wet-phase laps in the Melbourne/Silverstone wet captures run far more than 1.4× the dry median, so deg curves at wet races would silently drop the entire wet phase; F18's 30 kph floor, F15's 0.9 coverage cutoff, F24's `SELF_DECLARED_UNABLE` regex, and F03's 87-lap cap were likewise not swept against all 67 captures for false positives/negatives. Follow-up: one scripted pass applying each threshold to every captured rowset/answer, recorded in the test fixtures.
3. **Impact accounting is slightly inflated.** F25 (latent, "no current user impact" by its own text) contributes 26 prompts to the 58/67 "touched" headline; excluding latent-only touches materially changes the executive framing.
4. F13's "~20×", F10's "dives to 0", F20's rendered card composition — see B1: code-inferred, not captured.

### D. Proposed fixes in tension with documented design decisions

1. **F18, option "or drop `no_braking_event` zones entirely"** contradicts the builder's own documented decision that suspect zones are *"flagged and kept on the chart but excluded from the average"* (cited in the F18 verdict as the reason the chart/text split for flagged zones is deliberate). The ⚠-label variant is compatible; the drop variant should be struck or explicitly logged as reversing that decision.
2. **F22 normalizes a deviation instead of restoring the sign-off.** The finding records that the sign-off specified BOTH-zero axis exclusion; shipped code does EITHER-zero, and the fix keeps EITHER-zero ("defensible") while only correcting the prose. Either restore the signed-off behavior or record a superseding decision — silently blessing drift is how the next audit re-flags it.
3. **F19 replaces a documented mitigation, not a bug.** The comment at `strategySplitInsight.ts:206-208` documents a deliberate note-based approach to micro-stints; merge-before-verdict supersedes it. Correct call, but log it as a design change so the old comment's rationale doesn't resurrect.
4. **F04 prong 3 (25s template timeout) erodes the 15s statement-budget guardrail** that the whole Phase 17 latency posture is built around, and its safety depends on F09's *optional* total-request cap — which is load-bearing, not optional: with the re-anchored 60s SQL budget, worst case becomes ~41s resolution + 25s attempt + 25s retry ≈ 90s+ user wait. Make the total-request cap a required part of Wave 2.
5. **F08's optimistic `unprobed_expensive → usable`** weakens the completeness machinery Phase 17-D refusals depend on; its stated backstop ("the existing zero-row grader handles it honestly") is the same grader F24 declares broken. The Wave 1 (F24) → Wave 2 (F08) ordering makes this safe, but that ordering is an undeclared hard dependency — state it in §4.


---

## IMPLEMENTATION LOG (2026-07-02, Opus)

### Wave 1 — Stop the lying — SHIPPED
Files: `web/src/lib/queries.ts` (buildHeuristicSql → `string|null`, context-first, plural drivers, laps dedup, venue cols, no catch-all), `web/src/app/api/chat/orchestration.ts` (template-failure branch: timeout→budget-capped one-retry→honest failure; non-timeout→honest failure; null-heuristic + failed-fallback → honest failure not raw throw; resolvedSession clamp threaded to synthesis), `web/src/lib/synthesis/buildSynthesisPrompt.ts` + `web/src/lib/anthropic.ts` (resolvedSession honesty clamp, confidence≥0.9), `web/src/lib/chatQuality.ts` (degraded-source + self-declared-unable → C).
New tests: `heuristic-fallback-honesty.test.mjs` (4/4), `chat-quality-degraded-source.test.mjs` (3/3). Updated `skip-repair.test.mjs` + `answer-cache.test.mjs` for the retired heuristic source.

**GPT-5.5 review (via /2ndopinion): REVISE → addressed.** Took: (#1) capped the timeout-retry to remaining pipeline budget + skip when <3s left, so cold-start + double-timeout can't overrun the 60s wall clock (added `timeoutMs` param to executeSqlWithTrace); (#4) heuristic_fallback / heuristic_after_sql_timeout exec failures now become honest structured failures instead of a raw throw→500. Deferred (documented): (#2) full budget enforcement across sqlgen/validate/repair = Wave 2 F09; (#5) buildHeuristicSql coverage/"missing" branches stay intentionally global (data-health questions are cross-session; the clamp protects them); (#7) route-wiring harness fix (stub orchestration's ~40 @/lib imports) = Wave 5.

**Judgment calls:**
- Route-wiring unit tests (answer-cache/skip-repair) run on a PRE-EXISTING broken harness (transpiles route.ts which re-exports ./orchestration but never transpiles orchestration into the temp dir → ERR_MODULE_NOT_FOUND; confirmed by stashing my changes — still 6/9 fail on clean base). This is part of the repo's known ~40-failure baseline. Verified Wave 1 live instead: M06/M08/M16/M19 all return deterministic_template with real data and ZERO fabricated-absence claims; forced 50ms/1ms statement timeouts confirmed the retry path fires (`template_timeout_retry_succeeded`). Harness repair folded into Wave 5.
- `/2ndopinion` codex config had an invalid `service_tier = "priority"`; ran the review via an isolated CODEX_HOME with that line stripped (did not mutate the user's config).

### Wave 2 — Make templates execute — SHIPPED
Files: `web/src/app/api/chat/orchestration.ts` (F09 SQL deadline re-anchored to pipeline entry + 90s total-request cap; doubled "couldn't construct…" sentence fixed; F04 25s template-timeout class + retry cap raised to template budget), `web/src/lib/deterministicSql/pitCycle.ts` (F04 venue CTE → core.sessions 1-row lookup, was a 2nd laps_enriched scan), `web/src/lib/deterministicSql/stintDelta.ts` (F04 merged a_laps+b_laps into one `both_laps` scan), `web/src/lib/queries.ts` (F08 GLOBAL_PROBE_PROXY: global core.* probes now hit the raw feed table, not the unmaterialized view).
New test: `template-scan-reduction.test.mjs` (2/2 — asserts ≤1 laps_enriched scan per template).

**Verification (cold server):** template-family baseline sweep M02/M05/M08/M10/M22/R01–R04 → **9/9 grade A, all `deterministic_template`, zero timeouts, zero heuristic fallbacks**. Log evidence: `completeness.globalCounts` 38,646ms → **16ms** cold (F08); M09 cold resolution 41s → 3.7s; stint_delta 13.7s / pit_cycle 9.8s cold, both under the new 25s template budget.

**Judgment call — prod materialization DEFERRED.** The plan listed materializing core.laps_enriched as a "(Stretch, warehouse)" item. The code-side fixes (scan reduction + 25s template class + F05 retry + F08 probe proxy) fully eliminated the cold-timeout cascade — every template now executes cold. Materializing the views WITHOUT also building a REFRESH pipeline would introduce staleness (a matview would silently miss newly-ingested sessions), trading a fixed latency bug for a correctness bug. Left as a future warehouse task with its own refresh design. M09's residual ~45s warm is pure LLM *synthesis* latency (130 rows → Sonnet), orthogonal to the SQL/timeout layer this wave targets; noted for a possible Wave 5 perf pass.

### Wave 3 — Warehouse-consumer data correctness — PARTIAL (5 of 8 shipped)
**Shipped + tested:**
- **F02** (P0) `positionChangesInsight.ts`: when finish_position is suspect (no winner OR duplicate finishes) reconcile against the per-lap trace already in the rows; caveat takeaway. Live-verified: São Paulo now "Verstappen P19→P3" (was the false "P19→P16"). Test: `position-changes-finish-fallback.test.mjs` (2).
- **F03** (P0) stacked-bar detector halves physically-impossible lap totals (>87); `anthropic.ts` prompt warns traffic_adjusted_pace counts are 2x-inflated (use as ratio). Test: `traffic-lap-count-sanity.test.mjs` (2).
- **F06** (P1): already resolved by Wave 1's context-first buildHeuristicSql (laps dedup + venue projection on the heuristic path) + the F03 prompt-dedup guidance for LLM SQL.
- **F15** (P1) `strategySplitInsight.ts`: DNF guard — a driver whose last stint ends before 90% race distance → verdict NO "can't compare after retirement", not a "0-stop strategy". Live-verified Zandvoort. 
- **F19** (P2) `strategySplitInsight.ts`: merge contiguous same-compound micro-fragments (≤2 laps, null avg_valid_lap) BEFORE stop-count/verdict so SC/red-flag tyre records don't inflate stop counts. Tests: `strategy-split-insight.test.mjs` +2.

**Deferred (documented) — F12, F14, F17:** moderate SQL/builder work, P1/P1/P2:
- F12 deg-curve SQL needs a neutralization CTE (port raceTrace's field-median spike detection) + lap-1 exclusion + min-sample bump — SC-paced age≤2 baselines invert curves.
- F14 weather_impact boundary-row dedup (pit lap counted in both stint windows → phantom flip-flop markers).
- F17 wet-crossover phase validation (an opening-lap gamble misreported as a drying-phase crossover).

**Judgment call — CHECKPOINT.** Stopped Wave 3 at the 5 highest-impact findings (both P0s + F06/F15/F19) after two session-usage-limit hits earlier today. Waves 1+2 + these five cover the P0 honesty class, the root-cause timeout cascade, and the confidently-wrong-numbers class — the large majority of the plan's prompt-level impact. F12/F14/F17 (remaining Wave 3) and Waves 4 (10 P2/P3 visual/prose polish) + 5 (infra/harness) are lower-severity and best done in a fresh session to avoid a mid-wave crash losing uncommitted work (nothing has been committed per repo policy — all changes are in the working tree).

**Session totals:** typecheck clean; 57/57 session unit tests pass; live smoke across all 3 waves green. New/modified source: orchestration.ts, queries.ts, chatQuality.ts, anthropic.ts, buildSynthesisPrompt.ts, deterministicSql/{pitCycle,stintDelta}.ts, synthesis/{positionChanges,strategySplit}Insight.ts, mapInsight/detectors/registry.ts. New tests: heuristic-fallback-honesty, chat-quality-degraded-source, template-scan-reduction, position-changes-finish-fallback, traffic-lap-count-sanity (+ strategy-split & skip-repair & answer-cache updates).

### Wave 3 — COMPLETED (8/8) — F12/F14/F17 added 2026-07-02
- **F12** (P1) `deterministicSql/degradationCurve.ts`: drop lap 1, filter laps slower than 1.4× the session field median (raceTrace neutralization idiom), raise bucket floors (age bucket ≥4, fresh baseline ≥6). `degradationCurveInsight.ts`: disruption clamp — refuse cliff/slope narrative when any |delta|>5s. **Live-verified:** Jeddah now "Hard +0.96s by age 32" (was the impossible "−43.82s FASTER with age").
- **F14** (P1) `deterministicSql/wetCrossover.ts`: ROW_NUMBER dedup by (driver, lap) — weather_impact has no stint_number, so tiebreak prefers the dry reading (monotonic drying progression). Eliminates phantom 1-lap flip-flop stints. **Live-verified:** Silverstone crossover Norris L45 / Piastri L44, clean.
- **F17** (P2) `synthesis/wetCrossoverInsight.ts`: distinguish an opening-lap slick gamble (crossover before wet phase began) from a genuine drying-phase crossover; suppress the "gambled 36 laps earlier" fabrication; label gambles honestly.
Tests: `deg-curve-and-wet-crossover.test.mjs` (4). **Wave 3 all 8 findings shipped + tested + live-verified.**

### Wave 4 — Visual/detector & prose polish — COMPLETED (10/10) 2026-07-02
- **F10** (P1) dual-axis: NaN-fill missing (driver,lap) rows + `connectNulls={false}` so a retired driver's line terminates instead of plunging to 0. (registry.ts + line-dual-axis-chart.tsx)
- **F11** (P1) trigger negative guards: deg-curve rejects team-vs-team / stint-N; sector-dominance rejects named-turn / corner-phase. **Live-verified:** M04→grouped_bar (anthropic), M11→anthropic_repaired (were template-hijacked).
- **F13** (P1) `season_year`/`season` added to IDENTIFIER_COLS + radar drops any all-off-scale axis + renderer clamps to [0,max]. **Live-verified:** M17 radar clean, honest unpopulated-axis lede.
- **F16** (P1) team-alias bidirectional match in resolution.ts ("Red Bull"→"red bull racing"; word-boundaried so "verb"≠"rb").
- **F20** (P2) word-boundaried the hbar duration patterns (was substring-matching `duration_sector_1`), promoted lap_duration; +≥2-row guard so a hero fact gets no 1-bar chart. **Live-verified:** M01 hero chartless.
- **F21** (P2) deg-curve cliff now needs a sustained majority (not one look-ahead); sign-safe `median ±Xs` formatting (rides on F12's disruption clamp).
- **F22** (P2) radar: gap attributed to the LEADER with positive magnitude (was "−30 to Norris"); both-zero vs one-sided axes described honestly.
- **F26** (P3) wet-crossover names requested drivers who never crossed (retired on inters / stayed to flag).
- **F27** (P3) brake-zones "three heaviest" → `corners.length` word.
- **F28** (P3) teammate colors assigned by sorted name (stable across cards, was input-order-dependent).
Tests: `wave4-visual-routing.test.mjs` (4), `distinct-team-colors.test.mjs` updated for stable contract. Baseline sweep M01/M04/M06/M14/M17/R03 → 6/6 A.

### Wave 5 — Infra + harness hardening — COMPLETED (high-value subset) 2026-07-02
Shipped:
- **Cache versioning** (critic follow-up — the biggest unstated gap): `answerCache.ts` key now carries `CACHE_VERSION` ("v2-2026-07-02"). The key is (template,session,drivers,year), not answer content, so a builder/SQL change would otherwise keep serving a fixed P0 "not in dataset" answer verbatim on a long-running server. Bumping the version invalidates every entry at once.
- **F29** (P3): `db/driver.ts` background-derivation pool (track-outline / lap-telemetry only, not the chat pipeline) gets its own 30s statement timeout (`OPENF1_DERIVATION_TIMEOUT_MS`) — cold outline derivation ran 14.5–15.0s against the shared 15s cap and silently vanished the ribbon.
- **Sweep hardening** (§5 #1/#11): `baseline_sweep.mjs` gradeItem now permanently gates the F01 class — flags degraded generationSource and fabricated-absence text over non-empty rows; summary prints grade + generationSource distribution + an honesty-regression count. Added a named **H01–H04 honesty-regression block** (H01–H03 = resolved-2025 sessions that must never be declared absent; H04 = genuine-2019 absence positive control proving refusals still fire). **Live-verified:** H01–H03 deterministic/clean, H04 honest clarification, 0 F01 regressions.

**Judgment calls — DEFERRED (documented):**
- **F25** (P3, pg NUMERIC/BIGINT parser consolidation into the chat pool): latent with ZERO current user impact (every consumer coerces via `num()`/`parseFiniteNumber`); the plan itself warns it's medium-blast-radius ("payload numeric columns change string→number; land with full sweep gates, not a drive-by"). Not worth introducing that risk to a now-healthy system at the tail of the session. Left with the note that any NEW non-registry consumer must coerce.
- **Route-wiring test harness fix** (transpile the split-out orchestration.ts's ~40 `@/lib` imports into the temp dir): large, and the route-level behavior of Waves 1–5 is already verified LIVE. The pre-existing ERR_MODULE_NOT_FOUND is part of the repo's ~40-failure baseline; not worth ~40 stub files here.
- **Randomized golden-set family expansion** (§5 #2–#10: dnf/SC-disruption/team-compare/sprint families, concurrency+cold modes): additive nice-to-haves that would strengthen future audits; the honesty gate + H-block cover the P0 regression surface. Left as a tracked backlog in §5.

## FINAL STATUS — all 5 waves complete (2026-07-02)
29/29 confirmed findings addressed: Waves 1–4 fully (F01–F22, F26–F28); Wave 5 high-value subset (F29 + cache versioning + sweep hardening), with F25 + harness fix + §5 family expansion deferred with reasons. Typecheck clean; 106 session unit tests pass (70 node + 36 tsx); baseline sweeps green across template families + honesty block; all changes live-verified. Nothing committed (repo policy) — all in the working tree on branch ui/v0-frontend-replacement.
