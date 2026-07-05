<!-- CONVERGED 2026-07-02 via a 7-round /2ndopinion (GPT-5.5, xhigh reasoning) convergence loop.
Findings per round: iter1=6, iter2=4, iter3=2, iter4=3, iter5=2, iter6=1, iter7=0 → "AGREE — NO FINDINGS".
Both the author (Claude) and the adversarial reviewer (GPT-5.5 xhigh) sign off on this as
sufficient-and-necessary to bring every graded dimension to a MEASURED A. This is the ROADMAP
(what an A requires); it is NOT implemented — the 5 shipped waves are the prior-state fixes. -->

# Roadmap to a defensible A across all dimensions — v7

Goal: every graded dimension (Data correctness, Reliability/perf, Honesty, Grade-gate integrity, Visual, Overall) reaches a **measured, defensible A**, behind a blocking gate that makes the claim checkable. Integrates all /2ndopinion findings through iteration 6.

## Governing principle (iter-4/5): DERIVE, don't hand-list — across EVERY surface

Every "inventory" the gate depends on must be **extracted from source/catalog by a script**, not hand-enumerated — hand-lists are always incomplete. The derived inventories are:
1. production `templateKey`s (`deterministicSql.ts`/`topicGuards.ts`);
2. chart detectors (`registry.ts`);
3. observable `generationSource` values + code-level failure sub-states (`orchestration.ts`);
4. materialized layers — heap `*_mat` tables + true matviews (`pg_matviews`/`pg_class`);
5. **client-fetch chart APIs AND the renderer→API dependency EDGES** (iter-5 P0 + iter-6 P0) — derived from the `fetch()` / `useTrackOutline` call sites, not just the endpoint list: `/api/track-outline` is consumed by `track_speed_map` (`track-map.tsx:42/61`) AND `track_heatmap` via `MinisectorStrip` (`minisector-strip.tsx:27/30`) AND `track_corner_delta` (`track-corner-delta.tsx:14/15`); `/api/lap-telemetry` by `telemetry_overlay`. Each EDGE is classified `required` (chart is meaningless without the fetch) or `degraded-fallback` (renders a lesser form), with expected query shape + populated assertion + pixel-wait criteria — so a chart that silently falls back to strip/bars on an empty fetch is a gate failure, not a nonblank-pixel pass.
6. **renderer/card-slot surface** — `ChartType` enum + `ChartRenderer` branches (`charts/index.tsx:69-74`) + `InsightCard` slots (iter-5 P1).
The manifest stores a classification for each derived entry; the coverage check FAILS if any derived set contains an entry the manifest hasn't classified (gated / excluded / hard-truth / methodology-scoped / expected-refusal / pixel-gated). Self-completing; closes the "you missed enumerating X" class for ALL surfaces, not just chat.

## Definitions

- **A-surface coverage manifest (iter-1 F1 + iter-2 F4).** "A" is scoped, but the scope must be EXHAUSTIVE. Build `scripts/health/a_surface_manifest.json` enumerating THREE inventories, each entry `gated` (≥1 sweep prompt + fixture + criteria) or `excluded` (written reason):
  1. every production `templateKey` (51 in `deterministicSql.ts` / `topicGuards.ts:402`);
  2. every chart detector (23 in `registry.ts:1557`);
  3. **every route/failure state, in TWO layers, DERIVED FROM SOURCE (iter-2 F4 + iter-3 P0 + iter-4 P0/P1 — hand-lists kept missing members like `heuristic_after_sql_timeout`, `resolve_db_timeout`, `sql_repair_timeout`, `empty_tables:*`, `proprietary_no_data:*`, `completeness_blocked_execution`, `fallback_exec_failed`, `clarification_required`):**
     - **(3a) Observable `generationSource` values** — the check script EXTRACTS the set by scanning `orchestration.ts` for every `generationSource = "…"` assignment (and the trace `queryPath`/`failureSource` values that reach the payload), rather than trusting a prose list. Known members include `deterministic_template`, `anthropic`, `anthropic_repaired`, `heuristic_fallback`, `heuristic_after_sql_timeout`, `sql_generation_failed`, `no_data_refusal`, `runtime_clarification`, `runtime_unavailable`, `runtime_transient_db_unavailable`, and the no-source `runtime_failed_before_sql` catch — but the DERIVED set is authoritative.
     - **(3b) Code-level failure sub-states** — the script EXTRACTS every `code:`/status/`generationNotes` literal (`template_exec_*`, `heuristic_unavailable`, `resolve_db_timeout`, `sql_repair_timeout`, `proprietary_no_data:*`, `completeness_blocked_execution`, `fallback_exec_failed`, `empty_tables:*`, `clarification_required`, …) that collapse under a top-level source.
     Each derived state (both layers) must be classified in the manifest with a triggering prompt/fixture + pass criterion (any failure ⇒ honest structured failure, no fabricated absence; clarification ⇒ specific guidance; transient ⇒ honest error). Reconcile against the route tests (`streaming-synthesis-route.test.mjs:492/704`).
  The A-gate FAILS if the DERIVED set (templateKeys, detectors, observable sources, failure sub-states, materialized layers) contains ANY entry the manifest hasn't classified (gated/excluded) — `scripts/health/check_surface_coverage.mjs` extracts from source and diffs against the manifest. No production surface can be silently ungraded, and no future-added enum member can slip the gate.
- **A on a dimension** = the gate's criteria pass across cold + warm + concurrent runs, ≥3 seeds, zero waivers, over the full gated surface.
- **External truth** = FastF1 / official FIA data for a sampled slice (see Phase 3.5 for its scoped extent).

## Phase 0 — The blocking A-gate (prerequisite)

`scripts/health/a_gate.mjs` — one command, non-zero exit on any failure, no best-of retries (record WORST of N; replace `run_category_benchmarks.mjs:233` keep-best logic), judge mandatory (a judge ERROR is a gate failure). Composes: (1) `npm run verify`; (2) surface-coverage check; (3) full judged sweep; (4) external-truth sample; (5) pixel regression; (6) perf SLO (cold/warm/concurrent); (7) migration deploy+verify+**revert round-trip** on the target branch. `RUBRIC.md` updated so rendered-pixel + external-truth are no longer "known gaps"; it carries the per-dimension pass criteria table.

## Phase 1 — Repair + gate the migration chain (prerequisite to warehouse fixes)

`sqitch.plan` stops at 032/skips 028; deploy+verify files go to 051; **revert files stop at 032** (iter-1 F5).
- Add plan entries for `028` + `033`–`051` in dependency order (README.md:88 order is load-bearing).
- **File parity check**: `deploy/NNN`, `verify/NNN`, `revert/NNN` must all exist for every N (a gate assertion). Author the missing reverts 033–051.
- Deploy to a **Neon branch** (not prod): `sqitch deploy` → `sqitch verify` → `sqitch status` green.
- **Full-segment rollback gate (iter-2 F1):** `@HEAD^` only reverts the latest change (051), leaving 033–050 reverts unproven (`README.md:97`). Instead prove EVERY repaired revert: `sqitch revert --to 027 -y && sqitch deploy && sqitch verify` (roll the whole 028–051 segment back to the last-known-good and re-apply), OR a per-change revert→verify loop over 028–051. Gate passes only if the full segment rolls back and re-applies cleanly.

## Phase 2 — Reliability/perf → A (remove conditions, not just cap them)

- **Refresh pipeline covering ALL materialized layers (iter-1 F4), mechanism-correct per object type (iter-2 F2), from a SCHEMA-DERIVED inventory (iter-3 P1 — not a fixed shorthand list).** The materialized surface is larger than the four objects named earlier: heap-backed `core.*_mat` tables include `core.stint_summary_mat` (`011:11/54`) and `core.grid_vs_finish_mat` (`014:12/45`) behind public views that templates read (`strategy.ts:21`, `positionChanges.ts:41`); true matviews start at `core.session_completeness_data` (`028:24`) and `analytics.sector_dominance_data` (`032:19`) and continue through `036/039/045`. Required: **generate the inventory from the catalog** (`pg_matviews` for true matviews; the `*_mat` heap tables via `pg_class`/naming) rather than hand-listing, then per object assert the correct mechanism:
  - heap `*_mat` tables → per-session delete-then-insert WITH dedup (they preserve dup multiplicity by design, `010:67`);
  - true `MATERIALIZED VIEW`s → `REFRESH MATERIALIZED VIEW CONCURRENTLY` (needs a unique index; add where missing) so reads aren't blocked.
  Build a dependency-ordered driver; `rg REFRESH` currently finds no executable refresh path. Acceptance: the freshness gate DERIVES every heap/matview layer, and for EACH asserts refresh mechanism + a watermark (max staleness vs latest ingested `session_key`) + bounded lock window + refresh SLO. A layer absent from the derived inventory's gate is itself a gate failure.
- **Answer-cache freshness vs data (iter-2 F3).** Deterministic answers cache full rows/answers for 10 min keyed by template/session/drivers/year — NOT data version — and the route returns the cached payload BEFORE executing SQL (`answerCache.ts:5/48`, `orchestration.ts:969`). The existing `CACHE_VERSION` prefix only invalidates on CODE change, not DATA refresh, so a correctness-A can serve stale cached rows. Required: (a) fold a **warehouse data-version token** (e.g. max ingested session_key + refresh timestamp) into the cache key so a refresh invalidates cached answers; AND (b) the correctness/external-truth gates run **cache-bypassed** (a `--no-cache` sweep mode) so they measure live SQL, not a replay.
- **Client-fetch chart APIs are a first-class gated surface (iter-5 P0).** `track_speed_map` + `telemetry_overlay` are NOT fully answered by `/api/chat`; the rendered chart later fetches dense data from `/api/track-outline` and `/api/lap-telemetry` (`track-map.tsx:61`, `telemetry-overlay-chart.tsx:131`), which have their OWN module caches + `Cache-Control: public, max-age=86400` (`track-outline/route.ts:45/324/337`, `lap-telemetry/route.ts:31/127/160`) — so a card can render day-stale geometry after a refresh, and the current sweep marks these specs "drawable" WITHOUT fetching (`randomized_sweep.mjs:358`). Required, across three dimensions: (perf) their cold/warm/concurrent latency is in the SLO gate; (data) they're data-versioned (the 86400 max-age keyed on a warehouse-version token, invalidated on refresh) and their outputs enter the truth/plausibility tiers; (honesty/visual) the sweep must actually FETCH the dense payload and assert it populates (non-empty outline/traces) — a spec that 404s or returns empty is a gate failure, not a pass.
- **Latency graded** (was recorded-only, `RUBRIC.md:22`): deterministic-template p95 end-to-end < 8s cold / < 4s warm; zero statement timeouts.
- **Resolver cap — NOT done (iter-1 F6 correction).** Only the stale *comment* was updated; `OPENF1_RESOLVE_DEADLINE_MS` still defaults to **150000** (`orchestration.ts:447/455`) and sweeps still abort at 150000 (`randomized_sweep.mjs:697`, `baseline_sweep.mjs:154`). Task: after measuring cold-resolution p99 on the branch, lower the default (candidate 20–30s) AND the sweep abort, keeping ≥ measured p99 + margin. Measured, not guessed.
- **Concurrency/cold modes**: add `--concurrency N` + `--cold` (server-restart) to the sweeps; the perf class only reproduces under concurrent cold load.
- Gate: cold+warm+concurrent sweep meets SLO, zero timeouts.

## Phase 3 — Data correctness → A (fix at the canonical grain)

Consumer guards become defense-in-depth once source is correct. Source fixes (new migrations on the repaired chain):
- `core.laps_enriched`/`_mat`: dedup at source (unique grain session,driver,lap).
- `analytics.traffic_adjusted_pace` (039:79 `COUNT(*)`) → `COUNT(DISTINCT lap_number)`.
- `analytics.weather_impact`: dedup boundary rows in the view; remove the crutch from `wetCrossover.ts`.
- `core.grid_vs_finish` (008:237 position-history fallback): official classification; where session_result un-ingested emit NULL + a `finish_source` flag (no silent stale value).
- Degradation: implement fuel correction OR rename/scope the card "raw pace vs tyre age (not fuel-corrected)" so label matches math.
- **Data-invariant verifies** per migration: unique grain, no per-driver lap total > 87, no duplicate finish positions, expected populations.

## Phase 3.5 — External ground truth (scoped per family, iter-1 F2)

Winner/order/pole/stop-count is NOT sufficient — derived-analytics cards can be row-consistent yet wrong vs reality. **EVERY template in the derived inventory (§manifest, ~51) must carry a truth-tier classification (iter-4 P2 — not a named subset)**; the truth gate FAILS on any unclassified template. Tiers:
- **Externally validated (hard truth):** results, finishing order, pole, pit-stop count, lap-1 positions, sector-dominance winner, first-stop lap — checked against FastF1/official for ~8 sampled 2025 races within tolerance.
- **Methodology-scoped (declared model outputs):** derived-analytics cards (wet crossover, brake/corner zones, minisectors, telemetry overlay, speed map, driver radar, **plus rich cards outside the hard-truth subset — `single_driver_pit_cycle`, `single_driver_pace_cliff`, `inferred_overtakes`, `session_race_trace`, `compound_degradation_curve`, `driver_pair_stint_delta`**) are NOT claimed as external truth; each must (a) carry an in-card caveat naming its inference method and (b) pass a per-family **plausibility + internal-consistency** fixture (manifest tag `methodology_scoped`, caveat text asserted). Where an external anchor DOES exist (e.g. race trace's finishing gaps, pit-cycle's stop lap), that sub-claim is additionally hard-truth-checked.
- **Expected-refusal:** templates whose data is a known upstream gap.
This converts "can't externally validate" into a declared, testable, EXHAUSTIVE boundary rather than a silent gap on the un-listed templates.
- Known upstream gaps (Baku 2025 quali, un-ingested session_result) enumerated as **expected honest-refusal fixtures** — gate asserts refusal + "what we have" alternative.

## Phase 4 — Honesty + Grade-gate → A

- **Validators must GATE (not just trace).** `orchestration.ts:1763` packages pitStints/sectorConsistency/gridFinish/strategyEvidence/countListParity into the trace but never downgrades. A failed validator caps `adequacyGrade` at C and surfaces a caveat.
- **Real grader.** Replace `chatQuality.ts:128` `rows>0 ⇒ B`: A/B requires all applicable validators pass AND (in the sweep) judge factual-consistency ≥ threshold. Non-empty rows alone earn at most C.
- **Full judged sweep** — full gated surface + expanded families (DNF, SC/VSC, team-vs-team alias, absent-data/refusal controls, ambiguous-venue phrasing, wrong-session traps); ≥3 seeds; cold/warm/concurrent. Pass = zero fabricated absence, zero verdict-over-hedge, zero timeouts, judge factual/honesty/comms all A-band.
- **Reduce clamp reliance**: after Phase 1–3, template failures are rare, so honesty stops depending on the soft prompt clamp (`buildSynthesisPrompt.ts:380`) as the primary guarantee — belt-and-braces.

## Phase 5 — Visual → A (measure pixels, iter-1 F3 corrected)

- **Derive the renderer/card-slot inventory (iter-5 P1), not just detectors.** The user-visible visual surface is the `ChartType` enum + every `ChartRenderer` branch (`charts/index.tsx:37`) + `InsightCard` slots (`insight-card.tsx:129`) — richer than the detector list, and `/mock` is a hand-authored fixture manifest filtered to implemented fixtures (`manifest.ts:63`, `mock/page.tsx:35`). The check derives the ChartType/renderer-branch/card-slot set from source; the gate FAILS unless every renderer branch and card slot is classified `pixel-gated` or `excluded`.
- `/mock` renders only `IMPLEMENTED_FIXTURES`; **M07 + M23 are `follow_up` and NOT rendered** (`manifest.ts:11/128/287`) → mark `excluded` (deferred) in the manifest until implemented; they're not in the visual-A surface.
- Playwright visual-regression over the rendered `/mock` fixtures + live sweep-response fixtures, mobile (~380px) + desktop. Per renderer branch/card slot: non-blank chart, no overflow/clipping, axis labels visible, no off-scale vertices; client-fetch charts (`track_speed_map`, `telemetry_overlay`) actually populate after their real API fetch (per Phase 2 client-fetch-API gate).
- Wire as `verify:ui`, in the A-gate.

## Ceilings (scoped into acceptance criteria)

1. **LLM-fallback latency floor.** Out of the perf-A graded surface (declared in RUBRIC), in the honesty-A surface. Perf-A claimed only for deterministic-template cards; LLM path SLO = "honest streaming within the 90s request budget."
2. **Upstream OpenF1 gaps.** Not A-able as data, only as honest refusal; every known gap is an expected-refusal fixture; documented, not hidden.
3. **Derived-analytics external-validation gap (from iter-1 F2).** Cards whose outputs have no external ground truth are `methodology_scoped`: A means "internally consistent + method disclosed + plausibility-gated," never "matches reality."

## Sequence (highest leverage first)
0 (gate + surface manifest) → 1 (migration chain + reverts) → 3 (source grains) + 3.5 (truth tiers) → 4 (grader+validators+sweep) → 2 (refresh pipeline, then perf tune AFTER correctness) → 5 (pixels). Gate first so every phase is measured; perf tuning after correctness so we don't optimize wrong answers.

## The one thing that, if skipped, makes "everything is an A" false
The blocking A-gate (Phase 0) WITH exhaustive surface coverage — without it, "A" is asserted over a hand-picked subset, not measured over the whole product.
