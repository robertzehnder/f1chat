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
        recipes.mjs (NEW per-meeting module, loaded by figures.mjs when present)
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

## Gate reality (verified in the orchestra source)
`orchestra/runner.py` `_gate()` (lines 49–53) uses the `orchestra.toml` `[gate]` commands whenever
they are non-empty and falls back to the planner's gate only otherwise. The committed toml gate has
a self-defeating sequence: its `monza-figures` step (`figures.mjs --meeting 2026_1293 --verify`)
rewrites `analyst/2026_1293/figures/*.json` with fresh `built_at`/`checked_at` timestamps, and the
very next step (`gate_gpt6_post.sh`) rejects any diff under `analyst/2026_1293`. The planner
attempted to correct `orchestra.toml` directly; this session's permission mode denies file writes,
so the fix is routed through the repo instead, which the orchestrator CAN merge:

1. **Root cause (T1)**: `figures.mjs` gains deterministic writes. Subtlety (review r3): the
   compiler holds `NaN` for missing points but JSON serialization stores `null` — the committed
   `charge.json` contains such nulls — so the comparison must JSON-normalize the freshly compiled
   object (`JSON.parse(JSON.stringify(out))`) before deep-comparing with the parsed on-disk file,
   both minus the two timestamp fields. When equal, the original bytes are preserved. The toml's
   `monza-figures` step then leaves the protected path byte-clean, in every worktree, with no
   wrapper needed.
2. **Brief enforcement (T4)**: `scripts/gate_gpt6_post.sh` — a repo script the toml gate already
   executes — is hardened to the brief: 900–1400 words (was 850–1500), 3–5 compiled figures, run
   the T1 recipes test, and an env-file guard. This is the one planner-controllable executable
   hook in the committed gate.

**Human action at plan approval (optional hardening, not load-bearing):** mirror this plan's gate
block into `orchestra.toml` (or empty its `commands` to activate the planner gate). Until then the
committed toml gate is correct once T1+T4 merge; the only check that exists solely in the planner
block is `npm audit` (critical-only, prod deps — the stack-appropriate security scan; since this
run permits no dependency changes, any failure is pre-existing and is waived or deferred by the
human, never "fixed" by a task).

### Code change 1: per-meeting recipe modules (T1)
When `analyst/<meeting>/recipes.mjs` exists, `figures.mjs` imports it (via `pathToFileURL`) and
calls its default export with `ctx = { packet, ptr, text, renderText, racingState, colorOf,
surname, driverOf, traceIdx, pairIdx, lapIdx, TEAM_COLORS, COMPILER_VERSION }`; the returned
`{ name: () => figure }` map replaces the built-ins for that meeting. Meetings without one
(`2026_1293`) keep the built-ins on the unchanged code path.

### Code change 2: strict provenance mode for external recipes (T1)
`verifyFigure` today checks caption/alt slot binding and the two supported `series_sources`
shapes; unknown shapes are silently skipped, decorations are unchecked, per-point coverage is not
enforced, `src.laps` is only used in diagnostic messages (nothing binds a displayed lap to the
packet row it came from), and `want == null` accepts a misspelled path as "missing data". Strict
mode — applied ONLY to external-recipe figures; built-in Monza verification is untouched — closes
these by **binding, not membership**:
- **Exact per-point series coverage with lap identity**: every `chart.series` index needs a
  supported-shape source; `laps.length + (lap0_path ? 1 : 0)` must equal `values.length`; `laps`
  must deep-equal `chart.lap_numbers` when present. Each source additionally declares a
  **lap binding**: for `packet_path_template` sources, a `lap_path_template` over the same `{i}`
  indexing whose resolved value must equal `laps[i]` (and for `position_changes`, the implicit
  index-lap: row lap === array index); for `inputs` sources, parallel `lap_paths: [[pa, pb], …]`
  where both operands' laps must resolve to the displayed lap. This is what stops lap-40 data
  being plotted as lap 41 with internally consistent recipe-authored arrays.
- **Unresolved paths are failures, not missing data**: every declared source path must exist in
  the packet (walk the parent and check the property is present). A plotted `NaN` is legal only
  when the existing packet field is explicitly `null`; `NaN` against finite resolvable inputs, or
  any path that resolves to `undefined`, is a failure. (The shipped `want == null` check accepts
  typo'd paths; strict mode does not.)
- **Decoration binding** via a `decoration_sources` object: `chart_note` and every annotation
  text / pit-dot label / marker label is a `{template, slots}` whose re-render must byte-equal the
  string in `chart`, with the caption-style unbound-number scan and slot-path resolution applied;
  annotation `lap`, pit-dot `x`/`y` and `horizontal_marker.value` are slot-bound (the constant 0
  is allowed for zero lines).
- **racing_state recompute**: the recipe declares its window; the verifier recomputes
  `ctx.racingState(window)` and deep-compares with `chart.racing_state`.
- **stint_gantt cross-check**: `stints`/`gantt_stops` must equal their projections of
  `packet.stints`/`packet.stops` (surname, lap bounds, lowercased compound), stop labels must
  follow the class mapping (boundary_spanning→"red", vsc→"VSC", sc→"SC", else "green"), and
  `total_laps` must match the packet.
- **position_changes indexing**: the renderer labels laps by array index (index 0 = grid), so
  strict mode requires full-race grid-prefixed series (`values.length === total_laps + 1` with a
  `lap0_path`). Windowed lap plots must use `race_trace` or `line_with_stint_markers`.
Negative fixtures: tampered value, shortened/appended arrays, unknown shape, **both lap arrays
shifted together**, **mixed operand laps**, **misspelled path with NaN plotted**, unbound
decoration, wrong annotation-lap binding, tampered racing_state, wrong gantt label; positive
fixture for a legitimate packet null rendering as NaN.

### Code change 3: deterministic figure writes (T1)
As under "Gate reality": JSON-normalize the compiled object, strip
`provenance.built_at`/`verification.checked_at` from both sides, deep-compare, and skip the write
when equal — preserving original bytes. Console output and exit codes unchanged. Tested with a
fixture whose series contains missing values (NaN→null round-trip) and with the real Monza
meeting (`git status` clean afterwards — `charge.json`'s committed nulls make that test bite).

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
1. **T1** — recipe loader + strict provenance mode + deterministic writes + tests.
2. **T4** — harden `scripts/gate_gpt6_post.sh` (brief bounds, figure count, recipes test, env
   guard). Human approves the merge (it edits the verification gate).
3. **T2** — the full `analyst/2026_1293_gpt6/` package, pipeline end-to-end, PNGs exported.
   Atomic by design: the gate skips until the directory exists, then requires everything.
4. **T3** — per-renderer browser QA + PNG visual inspection + regression on `/blog/monza-2026`;
   `qa.md` evidence.

## Risks
- **Gate atomicity makes T2 large.** Accepted; all code lands first (T1/T4) and T2's description
  spells out every verifier rule.
- **Strict number provenance and the style linter force iteration.** Budgeted in T2.
- **Deterministic-write comparison must ignore ONLY timestamps and must JSON-normalize** (NaN vs
  null). T1's tests include a missing-value determinism fixture, a content-change-still-writes
  case, and the real-Monza clean-status check.
- **Lap-binding requirements make recipes slightly more verbose** (lap_path_template/lap_paths);
  the cost is small and the alternative — internally consistent but wrong lap labels — is exactly
  the failure the brief exists to prevent.
- **Port 3101 contention** between the task's dev server and the orchestrator QA server;
  `parallel = 1` mitigates, `--base` accepts any port.
- **T4 pauses for human approval** (it edits the gate script); briefly blocks the run —
  acceptable for a change to the verification gate itself.

## Open questions for the human
- At plan approval: optionally mirror this plan's gate block into `orchestra.toml` (or empty its
  `commands` to activate the planner gate). The run works without it once T1+T4 merge; only the
  `npm audit` check lives solely in the planner block.
- If `npm audit` (when active) flags a pre-existing critical advisory, waive it; dependency work
  belongs to a separate run.

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
