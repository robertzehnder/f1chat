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

## State after T5 (merged b7ceb97)
The package is complete and the accepted T2 defect is closed. Verified in the merged tree:
- `race-trace-chart.tsx` now renders `horizontal_marker` when present as a dashed
  `<ReferenceLine y={value}>` with an `insideBottomRight` label at font 9, a verbatim mirror of the
  `line-with-stint-markers.tsx` block (the label position also dodges the reversed Y axis). It is a
  purely additive conditional: absent marker → nothing rendered, so `monza-2026`'s `gap_trace` and
  `charge` are unchanged by construction. T2's `isAnimationActive={false}` and the frozen
  racing-state layer are untouched.
- `race-trace-export.test.ts` asserts, per gpt6 figure, exactly one ReferenceLine at y=0 carrying
  "Level at the line", plus a dedicated absence case on `analyst/2026_1293/figures/gap_trace.json`
  (zero ReferenceLines). All pre-existing assertions intact.
- All six PNGs (public + analyst figures dir) were re-exported; the reviewer opened each and
  confirmed the labelled zero line with traces crossing it, matching the alt texts. Diff was
  exactly the eight permitted files; protected paths clean.
- **QA recorded "blocked" on T5 as well as T2** — no browser verification has run in this entire
  project. T3 is that verification and is mandatory, not a formality.
- **Out-of-scope observation from the T5 merge**: the bare figure route renders the article-title
  header ("Antonelli's Monza recovery…") on every exported figure/PNG — pre-existing export-route
  behavior, present before this run and presumably on the `monza-2026` exports too. T3 records
  this as an observation in qa.md (it is not a defect introduced by this run and not a T3 failure);
  whether to change the export route is a decision for a future run.

State after T2 (merged 9488392), still accurate: report.md is 931 body words; three figures —
`early_lead_exchange` (laps 11–24), `unequal_recoveries` (laps 27–53, the hero), `mclaren_finish`
(laps 43–53) — all `race_trace` pair-gap charts from `packet.pair_gaps` with full lap bindings,
racing-state windows, and slot-bound text; `recipes.mjs` uses no `derive`-literal or `const` slots;
the post builds, three PNGs export, `/blog/monza-2026-gpt6` is in the blog store. Thesis (divergent
recoveries from a shared lap-28 VSC stop, Verstappen as the parallel control) is genuinely distinct
from the original post; the reviewer spot-checked the packet paths behind every headline number.

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
`build_post.mjs` copies `chart` wholesale into the blog JSON, which is why T5 needed no rebuild —
renderer + PNG re-export only, exactly as merged.

## Gate reality (resolved)
The committed `orchestra.toml` gate is authoritative and green end-to-end: typecheck, racing-state
test, adapter test, `figures-recipes-test` (T1's suite), `monza-figures` (snapshot/EXIT-trap
restore around `--meeting 2026_1293 --verify`), `brief-bounds` (900–1400 words, 3–5 figures),
`gpt6-post` (`scripts/gate_gpt6_post.sh`), `secret-files`. T4 stays dropped — every check it would
have added already runs in the toml gate. `npm audit` lives only in the planner gate block; any
failure there is pre-existing and is waived by the human, never "fixed" by a task.

### Verifier contract as merged (T1 — unchanged)
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
- `race-trace-chart.tsx`: renders `horizontal_marker` since T5 (mirroring
  `line-with-stint-markers.tsx:179-186`); `isAnimationActive=false` since T2; both changes pinned
  by `web/scripts/tests/race-trace-export.test.ts`.
- `line-with-stint-markers.tsx` renders `horizontal_marker` as a labelled ReferenceLine —
  the existing post's `closing_rate` proves it in production.
- `stint_gantt` renders with HTML/CSS divs, no SVG; `position_changes` labels laps by array index.
- The merged gpt6 post contains **only race_trace figures**, so T3's per-renderer split is:
  SVG data-mark assertions (including the zero ReferenceLine) for all three new figures; the gantt
  assertion applies only to the `monza-2026` regression check (`strategy_split`).
- `chart-types.ts:210` types `horizontal_marker` on line charts; the chat-side detector at
  `mapInsight/detectors/registry.ts:1859` also emits one, so T5's rendering was additive for chat too.

## Data model (unchanged; source of truth is the verifying code)
Figure JSON, sidecar, and post-meta shapes as in v5. The merged sidecar, figure JSONs, and blog
JSON verified under those rules and are frozen; no remaining task regenerates any of them.

## Stack
Unchanged: Node 20 ESM scripts, Next.js 15 + Recharts, Playwright (installed) for PNG export,
`node --test`/`tsx --test`. No new dependencies; no lockfile changes.

## Milestones
1. **T1** — recipe loader + strict provenance mode + deterministic writes + tests. **DONE** (a682103).
2. **T2** — the full `analyst/2026_1293_gpt6/` package, pipeline end-to-end, PNGs exported.
   **DONE** (9488392).
3. **T5** — render the declared `horizontal_marker` in `RaceTraceChart`, extend the element-tree
   test, re-export the three gpt6 PNGs. **DONE** (b7ceb97): additive conditional + absence-case
   test; reviewer visually confirmed the zero line on all three PNGs; diff exactly the eight
   permitted files.
4. **T3** — per-renderer browser QA + PNG visual inspection + regression on `/blog/monza-2026`.
   The last open task; the only step that has ever exercised a real browser in this run.

## Risks
- **QA has never run.** Both T2 and T5 recorded QA "blocked"; every browser-level claim so far is
  from element-tree tests and manual PNG opens. T3 is the substantive check — especially the
  `monza-2026` regression, since `race-trace-chart.tsx` changed twice this run (T2 animation,
  T5 marker) and the old post's `gap_trace`/`charge` must show no stray reference line.
- **Port 3101 contention** between a task dev server and the orchestrator QA server; `parallel = 1`
  mitigates, `--base`/export accept any port.
- The figure-header observation (article title on bare figure routes) could tempt T3 into an
  out-of-scope "fix"; T3 is instructed to record it, not change the export route.

## Open questions for the human
- None blocking. Two notes: (1) `npm audit` lives only in the planner gate block; if it flags a
  pre-existing advisory, waive it — dependency work belongs to a separate run. (2) The bare figure
  route stamps the article title on every exported figure (pre-existing, affects both posts'
  PNGs); say the word if you want a future run to slim the export route — it is out of scope here.

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
- v6 (2026-09-09): replan after T2 merged (9488392). T2's shared-code animation fix noted as
  shipped; the accepted `horizontal_marker` defect promoted to T5; T3 re-pinned to the merged
  all-race_trace figure set and made dependent on T5.
- v7 (2026-09-09): replan after T5 merged (b7ceb97). Merge verified against the task spec:
  additive ReferenceLine mirror of line-with-stint-markers, per-figure + absence-case tests, six
  PNGs refreshed, exactly the eight permitted files in the diff. T3 unchanged in substance — its
  zero-line assertions now check merged reality — with two additions: QA "blocked" on T5 as well
  (T3 remains the first real browser run), and the merge's out-of-scope observation (article-title
  header on bare figure routes, pre-existing) is recorded in qa.md as an observation, not fixed.
