# PLAN — GPT-6 writes its own Monza 2026 post

## Goal
Produce a second, independent article on the 2026 Italian GP (session 11361), authored by the
implementing agent (GPT-6 Astra) from `analyst/2026_1293/packet.json`, published at
`/blog/monza-2026-gpt6` via the existing analyst pipeline, with every number traceable, every
figure slot-bound and verified, and the existing `monza-2026` post untouched.

## Non-goals
- No database access, no packet regeneration, no changes to `analyst/2026_1293/`.
- No new chart renderers or chart types; recipes are restricted to the four types the existing
  post proved render correctly (`race_trace`, `position_changes`, `line_with_stint_markers`,
  `stint_gantt`).
- No changes to the racing-state layer, the chat route, migrations, lockfiles, or deploy.
- No LLM-judge or human style-approval loop in-gate; `style_lint.mjs` is the deterministic bar.

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
The blog store is file-backed: dropping `monza-2026-gpt6.json` into `web/content/blog/` makes it
appear on `/blog` and render at `/blog/monza-2026-gpt6`; the bare figure route
`/blog/<slug>/figure/<name>` drives PNG export.

## Gate reality (resolved)
The concern from v2–v4 is closed. At 7dfaa01 the human adopted the planner's gate into the
committed `orchestra.toml`: `monza-figures` now snapshots `analyst/2026_1293/figures` to a temp
dir and restores it via an EXIT trap (so the protected path is byte-clean regardless), and the
toml gate additionally runs `figures-recipes-test` (the T1 test, conditional on the file — which
now exists on main), `brief-bounds` (900–1400 words, 3–5 compiled figures, skip while the gpt6
dir is absent), and `secret-files` (rejects any `.env` path in the diff). T1's deterministic
writes merged on top, so the snapshot/restore and the no-op rewrite are belt and braces.

**Consequence: T4 is dropped.** Every check it would have added to `scripts/gate_gpt6_post.sh`
(tightened word bound, figure count, recipes test, env guard) already runs in the committed toml
gate. The script's internal 850–1500 bound is looser than its own message, but the toml
`brief-bounds` step (900–1400) is the binding constraint, so the inconsistency is benign and not
worth a human-approval pause to fix. The only check that still lives solely in the planner gate
block is `npm audit` (critical-only, prod deps); since this run permits no dependency changes,
any failure there is pre-existing and is waived or deferred by the human, never "fixed" by a task.

### Verifier contract as merged (T1, verified in code — recipe authors code against THIS)
`figures.mjs` loads `analyst/<meeting>/recipes.mjs` when present and calls its default export with
`ctx = { packet, ptr, text, renderText, racingState, colorOf, surname, driverOf, traceIdx,
pairIdx, lapIdx, TEAM_COLORS, COMPILER_VERSION }`; the returned `{ name: () => figure }` map
replaces the built-ins for that meeting. External figures are verified by
`verifyExternalFigure` (strict mode); built-in Monza verification is unchanged. Strict mode:
- **Exactly one `series_sources` entry per series index**; unknown indexes, duplicates, or
  uncovered series fail.
- `packet_path_template` sources require `{series, packet_path_template ("{i}"), index_from ≥ 0,
  laps[], lap_path_template ("{i}")[, lap0_path]}`: `laps.length + (lap0_path?1:0) ===
  values.length`; `laps` deep-equals `chart.lap_numbers` when present; each row's resolved
  `lap_path_template` value must equal `laps[i]` (and for `position_changes`, the array index);
  each value must equal its resolved packet path at 1e-6.
- `inputs` sources require parallel `lap_paths` AND `chart.lap_numbers` of the same length; the
  chart value must equal `+(a − b).toFixed(3)`; both operands' laps must resolve to the displayed
  lap; a packet-null operand → plotted `NaN` is legal; `position_changes` cannot use this shape.
- **Unresolved paths are failures**: every declared path must exist property-by-property in the
  packet; `NaN` is legal only against an explicit packet `null`.
- **Slots**: `{packet_path}` | `{derive:{op: sub|div|mean|count, inputs:[path|number]}}` |
  `{const: string}` — strict mode rejects `const` strings containing digits. Formats: `0.0`,
  `0.00`, `0.000`, `int`, `ordinal`, `lower`, `surname`. ⚠ Accepted hole: the verifier does NOT
  check numeric literals inside `derive.inputs`; recipes in this run are forbidden to use them
  (T2 constraint, enforced at review) — every displayed number must trace to packet paths.
- **Decorations** via `decoration_sources`: `chart_note: {template, slots}`;
  `annotations: [{lap:<slot>, text:{template,slots}}]` and
  `trace_pit_dots: [{x:<slot>, y:<slot>, label:{template,slots}}]` parallel to the chart arrays;
  `horizontal_marker: {value: 0 | <slot>, label:{template,slots}}` (the zero line is the literal
  `value: 0`). All bound text gets the byte-equality re-render + unbound-number scan. Annotation
  laps must be path- or derive-bound (a digit-free `const` cannot carry a lap).
- **racing_state**: whenever `chart.racing_state` exists, `decoration_sources.racing_state_window`
  (`null` or `[from,to]`) is required and the verifier requires `JSON.stringify` equality with
  `ctx.racingState(window)` — so recipes must build the layer with exactly that call and window.
- **stint_gantt**: `stints` entries must deep-equal projections `{driver: surname(s.driver),
  start: s.laps[0], end: s.laps[1], compound: lowercase}` of `packet.stints`; `gantt_stops` match
  on `surname(s.acronym)` + lap with label from class (`boundary_spanning`→"red", `vsc`→"VSC",
  `sc`→"SC", else "green"); `total_laps` must match the packet.
- **position_changes**: full race, grid-prefixed (`values.length === total_laps + 1` with
  `lap0_path`).
Deterministic writes: compiled output is JSON-normalized (NaN→null), both sides stripped of
`provenance.built_at`/`verification.checked_at`, and the write is skipped when deep-equal.
`build_post.mjs` copies only `chart`/`caption.rendered`/`alt.rendered` per figure, so
`decoration_sources` never reaches the blog JSON (no downstream impact). Figure names must match
`/^[a-z0-9_-]+$/i` for `{{fig:name}}` placeholders.

## Data model (unchanged; source of truth is the verifying code)
- **Figure JSON**: `{ name, chart, caption: {template, slots, rendered}, alt, series_sources,
  decoration_sources (external recipes), provenance, verification }`. Slots bind by slash
  JSON-pointer or `derive` ops (sub/div/mean/count).
- **Sidecar** (`verify_draft.mjs` + `analyst/2026_1293/sidecar.json` as reference):
  `{ report, packet_version, review_mode, claims[], contract{} }`; dotted `packet:` refs,
  `moment:` ids, `attributed:` sources. Contract beats C1–C10 with status+reason; C2 needs a
  `moment:` ref; causal claims need review outcomes; material rejected/unresolved blocks.
  **This run's honesty tightening**: `attributed:` may only name sources present in the packet
  (the race-control record) — the implementer has no press access, so unsupported causes are
  withheld; quantities are written as numerals so the number scanner sees them.
- **Post meta**: `{ slug, dek, published_at, author, meeting_key: 1293, session_key: 11361,
  hero_figure, figure_order[] }`.

### Renderer reality (verified in web/src/components/f1-chat/charts/)
`metric_grid` is in build_post's allowlist but has no ChartRenderer case; plain `line` ignores
`racing_state`/`lap_numbers`; **`stint_gantt` renders with HTML/CSS divs and contains no SVG**;
`position_changes` labels laps by array index. Consequences: T2 uses only the four proven types;
T3 asserts per-renderer (Recharts data marks inside SVG for the three line-family types; driver
rows + nonzero-width compound bars for gantt) — the existing post's `strategy_split` is a gantt,
so a blanket SVG assertion could never pass.

## Stack
Unchanged: Node 20 ESM scripts, Next.js 15 + Recharts, Playwright (installed) for PNG export,
`node --test`/`tsx --test`. No new dependencies; no lockfile changes.

## Milestones
1. **T1** — recipe loader + strict provenance mode + deterministic writes + tests. **DONE**
   (merged a682103; implementation verified against the spec during replan).
2. **T2** — the full `analyst/2026_1293_gpt6/` package, pipeline end-to-end, PNGs exported.
   Atomic by design: the gate skips until the directory exists, then requires everything.
   Now depends only on T1 (T4 dropped).
3. **T3** — per-renderer browser QA + PNG visual inspection + regression on `/blog/monza-2026`;
   `qa.md` evidence.

## Risks
- **Gate atomicity makes T2 large.** Accepted; all code landed in T1 and T2's description spells
  out every verifier rule as merged.
- **Strict number provenance and the style linter force iteration.** Budgeted in T2.
- **Derive-literal hole**: the merged verifier accepts numeric literals in `derive.inputs`. Closed
  by task constraint (T2 forbids them) and planner review of `recipes.mjs`, not by more code.
- **Script/toml bound mismatch**: `gate_gpt6_post.sh` still checks 850–1500 internally; the toml
  `brief-bounds` step (900–1400) is the binding constraint. Benign; T2 targets 900–1400.
- **Lap-binding requirements make recipes slightly more verbose** (lap_path_template/lap_paths);
  the cost is small and the alternative — internally consistent but wrong lap labels — is exactly
  the failure the brief exists to prevent.
- **Port 3101 contention** between the task's dev server and the orchestrator QA server;
  `parallel = 1` mitigates, `--base` accepts any port.

## Open questions for the human
- None blocking. `npm audit` (critical-only, prod deps) still lives only in the planner gate
  block; if it ever runs and flags a pre-existing advisory, waive it — dependency work belongs to
  a separate run.

## Plan history
- v1 (2026-09-09): initial plan. Recipe loader → atomic authoring → browser QA.
- v2 (2026-09-09): review r1. Snapshot/restore around Monza verify; membership-based strict mode;
  four proven chart types; attribution/word-form bans; 900–1400 + 3–5 in planner gate.
- v3 (2026-09-09): review r2. Runner prefers the toml gate → fix moved into the repo
  (deterministic writes in T1, gate-script hardening in new T4); strict mode redesigned from
  membership to binding; per-point series coverage; gantt QA rewritten (no SVG);
  position_changes full-race rule.
- v4 (2026-09-09): review r3, all three issues verified and accepted. Deterministic-write
  comparison JSON-normalizes before diffing (committed charge.json holds nulls where the compiler
  holds NaN); strict mode binds each displayed lap to its packet row (`lap_path_template` /
  `lap_paths`, index-lap check for position_changes); unresolved source paths are failures — NaN
  is legal only against an explicit packet null. New fixtures for shifted lap arrays, mixed
  operand laps, typo'd paths, and legitimate nulls.
- v5 (2026-09-09): replan after T1 merged. Implementation verified to match the spec; contract
  details from the merged code (exactly-one-source-per-series, inputs = a−b toFixed(3) with
  lap_numbers required, digit-free const slots, literal `value: 0` zero line, racing_state via
  `ctx.racingState(window)` verbatim, derive-literal hole) folded into the plan and T2. The human
  had adopted the planner gate into orchestra.toml at 7dfaa01 (snapshot/restore monza-figures,
  brief-bounds, recipes test, secret-files), so **T4 dropped as redundant** (id never reused) —
  removing its human-approval pause; T2 now depends only on T1. T3 unchanged.
