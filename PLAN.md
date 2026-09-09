# PLAN — GPT-6 writes its own Monza 2026 post

## Goal
Produce a second, independent article on the 2026 Italian GP (session 11361), authored by the
implementing agent (GPT-6 Astra) from `analyst/2026_1293/packet.json`, published at
`/blog/monza-2026-gpt6` via the existing analyst pipeline, with every number traceable, every
figure slot-bound and verified, and the existing `monza-2026` post untouched.

## Non-goals
- No database access, no packet regeneration, no changes to `analyst/2026_1293/`.
- No new chart types; renderer changes only where a merged figure genuinely needs one (the brief's
  sanctioned path — exercised once in T2 for animation honesty, once in T5 for the zero marker).
- No changes to the racing-state layer, the chat route, migrations, lockfiles, or deploy.
- No LLM-judge or human style-approval loop in-gate; `style_lint.mjs` is the deterministic bar.

## State after T2 (merged 9488392)
The full `analyst/2026_1293_gpt6/` package exists and the whole toml gate is green: report.md is
931 body words; three figures — `early_lead_exchange` (laps 11–24), `unequal_recoveries`
(laps 27–53, the hero), `mclaren_finish` (laps 43–53) — all `race_trace` pair-gap charts built
from `packet.pair_gaps` with full lap bindings, racing-state windows, and slot-bound text;
`recipes.mjs` uses no `derive` slots and no `const` slots at all (the derive-literal hole is moot);
the post builds, three PNGs are exported, and `/blog/monza-2026-gpt6` is in the blog store.
Thesis (divergent recoveries from a shared lap-28 VSC stop, Verstappen as the parallel control) is
genuinely distinct from the original post's cheap-stop counterfactual; reviewer spot-checked the
packet paths behind every headline number.

Two facts from the merge that the remaining work must absorb:
1. **Shared-code change shipped in T2**: `race-trace-chart.tsx` now sets `isAnimationActive=false`
   (PNG exports could otherwise freeze mid-animation with partially drawn traces), guarded by
   `web/scripts/tests/race-trace-export.test.ts`, which inspects the renderer's element tree
   against the three merged figure JSONs. This also affects the live chat UI (benignly).
2. **Accepted defect, now closed by T5**: all three figures declare
   `horizontal_marker: {value: 0, label: "Level at the line"}` and the verifier passed it, but
   `RaceTraceChart` ignores `horizontal_marker` entirely (unlike `line_with_stint_markers.tsx:179`,
   which renders it as a ReferenceLine). Two of the three alt texts describe curves "crossing the
   level line" — a visual element the published PNGs do not contain. That fails honesty-over-polish,
   and a gap chart whose story is zero-crossings genuinely needs its zero line. T5 renders it and
   re-exports the three PNGs; the figure JSONs, blog JSON, and sidecar are already correct and do
   not change.

## Architecture (all existing, boring, file-backed)
```
analyst/2026_1293/packet.json  ──copy (byte-identical)──▶  analyst/2026_1293_gpt6/packet.json
                                                              │
        recipes.mjs (per-meeting module, loaded by figures.mjs when present — MERGED in T1)
                                                              ▼
figures.mjs --meeting 2026_1293_gpt6 --verify  ▶  analyst/2026_1293_gpt6/figures/*.json
report.md + sidecar.json  ──verify_draft.mjs / style_lint.mjs──▶ verified prose
post.md + post.meta.json  ──build_post.mjs (fail-closed gates)──▶ web/content/blog/monza-2026-gpt6.json
export_figures.mjs --slug monza-2026-gpt6 --base http://localhost:3101
                                          ▶ web/public/blog/monza-2026-gpt6/*.png
```
The blog store is file-backed; the bare figure route `/blog/<slug>/figure/<name>` drives PNG export.
`build_post.mjs` copies `chart` wholesale into the blog JSON, so the already-declared
`horizontal_marker` reaches the renderer without any rebuild — T5 is renderer + PNG re-export only.

## Gate reality (resolved)
The committed `orchestra.toml` gate is authoritative and green end-to-end: typecheck, racing-state
test, adapter test, `figures-recipes-test` (T1's suite), `monza-figures` (snapshot/EXIT-trap
restore around `--meeting 2026_1293 --verify`), `brief-bounds` (900–1400 words, 3–5 figures),
`gpt6-post` (`scripts/gate_gpt6_post.sh`), `secret-files`. T4 stays dropped — every check it would
have added already runs in the toml gate. `npm audit` lives only in the planner gate block; any
failure there is pre-existing and is waived by the human, never "fixed" by a task.

### Verifier contract as merged (T1 — unchanged; recipes were reviewed against it)
`figures.mjs` loads `analyst/<meeting>/recipes.mjs` (default export `(ctx) => map`) and verifies
external figures in strict mode: exactly one `series_sources` entry per series index;
`packet_path_template` sources bind each displayed lap to its packet row via `lap_path_template`;
`inputs` sources need parallel `lap_paths` + `chart.lap_numbers` with `+(a−b).toFixed(3)` equality;
unresolved paths fail (NaN legal only against explicit packet null); decoration binding via
`decoration_sources` (chart_note / annotations / trace_pit_dots / horizontal_marker with the zero
line as literal `value: 0`); `racing_state` must JSON-equal `ctx.racingState(window)` for the
declared `racing_state_window`; gantt and position_changes projection rules as specified in T1.
Deterministic writes keep `git status` clean on re-runs, which `monza-figures` → `gpt6-post` rely on.

## Renderer reality (verified in web/src/components/f1-chat/charts/)
- `race-trace-chart.tsx`: no `horizontal_marker` handling (T5 adds it, mirroring
  `line-with-stint-markers.tsx:179-186`); `isAnimationActive=false` since T2.
- `line-with-stint-markers.tsx` renders `horizontal_marker` as a labelled ReferenceLine —
  the existing post's `closing_rate` proves it in production.
- `stint_gantt` renders with HTML/CSS divs, no SVG; `position_changes` labels laps by array index.
- The merged gpt6 post contains **only race_trace figures**, so T3's per-renderer split is:
  SVG data-mark assertions for all three new figures; the gantt assertion applies only to the
  `monza-2026` regression check (`strategy_split`).
- `chart-types.ts:210` already types `horizontal_marker` on line charts; the chat-side detector at
  `mapInsight/detectors/registry.ts:1859` also emits one, so T5's rendering is additive for chat too.

## Data model (unchanged; source of truth is the verifying code)
Figure JSON, sidecar, and post-meta shapes as in v5. The merged sidecar and figure JSONs verified
under those rules and are frozen unless a task explicitly reruns the pipeline.

## Stack
Unchanged: Node 20 ESM scripts, Next.js 15 + Recharts, Playwright (installed) for PNG export,
`node --test`/`tsx --test`. No new dependencies; no lockfile changes.

## Milestones
1. **T1** — recipe loader + strict provenance mode + deterministic writes + tests. **DONE** (a682103).
2. **T2** — the full `analyst/2026_1293_gpt6/` package, pipeline end-to-end, PNGs exported.
   **DONE** (9488392): 931 words, 3 race_trace figures, distinct thesis, all gate steps green;
   shipped the race-trace animation fix + element-tree test as a justified shared-code change.
3. **T5** — render the declared `horizontal_marker` in `RaceTraceChart` (the accepted T2 defect):
   ReferenceLine + label when present, extend the element-tree test, re-export the three gpt6 PNGs.
   Small, sanctioned by the brief's "renderer feature only if a figure genuinely needs it".
4. **T3** — per-renderer browser QA + PNG visual inspection + regression on `/blog/monza-2026`;
   runs after T5 so QA sees (and asserts) the zero line in the final published state.

## Risks
- **T5 touches a live chat-UI component.** Scope is one additive conditional (render a declared
  optional field the type system already carries); the element-tree test pins it, and T3 regression
  checks `/blog/monza-2026` (whose race_trace figures declare no marker, so they must not change).
- **PNG re-export churn**: T5 rewrites three PNGs in two places (public + analyst figures dir);
  byte diffs are expected and confined to the gpt6 slug. `monza-2026` assets must stay untouched —
  export runs only with `--slug monza-2026-gpt6`.
- **Port 3101 contention** between a task dev server and the orchestrator QA server; `parallel = 1`
  mitigates, `--base`/export accept any port.
- QA on T2 recorded status "blocked" — browser verification has not actually run yet; T3 is that
  verification and stays mandatory, not a formality.

## Open questions for the human
- None blocking. `npm audit` (critical-only, prod deps) still lives only in the planner gate block;
  if it ever flags a pre-existing advisory, waive it — dependency work belongs to a separate run.

## Plan history
- v1 (2026-09-09): initial plan. Recipe loader → atomic authoring → browser QA.
- v2 (2026-09-09): review r1. Snapshot/restore around Monza verify; membership-based strict mode;
  four proven chart types; attribution/word-form bans; 900–1400 + 3–5 in planner gate.
- v3 (2026-09-09): review r2. Fix moved into the repo (deterministic writes in T1, gate-script
  hardening in T4); strict mode redesigned from membership to binding; per-point series coverage;
  gantt QA rewritten (no SVG); position_changes full-race rule.
- v4 (2026-09-09): review r3 accepted. JSON-normalized deterministic-write comparison; per-lap
  binding (`lap_path_template`/`lap_paths`); unresolved paths are failures; new fixtures.
- v5 (2026-09-09): replan after T1. Merged verifier contract folded into T2; human adopted the
  planner gate into orchestra.toml at 7dfaa01, so T4 dropped as redundant; T2 depends only on T1.
- v6 (2026-09-09): replan after T2 merged (9488392). Package verified in the repo: 931 words,
  3 race_trace figures, distinct thesis. Two absorptions: T2's shared-code animation fix noted as
  shipped; the reviewer-accepted defect — `horizontal_marker` declared by all three figures (and
  described by two alt texts) but silently dropped by RaceTraceChart — promoted to new task T5
  (render it, extend the element-tree test, re-export gpt6 PNGs) because it violates
  honesty-over-polish on published figures. T3 re-pinned to the actual merged figure set (all
  race_trace; gantt assertion only for the monza-2026 regression; zero-line assertions added) and
  now depends on T5. T4 remains dropped.
