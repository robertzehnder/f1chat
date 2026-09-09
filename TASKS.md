# Tasks (plan v4 · second opinion: off)

A second, independent GPT-6-authored Monza 2026 article is live in the repo at analyst/2026_1293_gpt6/ and published to /blog/monza-2026-gpt6; T5 just merged the missing zero-line rendering in RaceTraceChart and re-exported the three PNGs, verified in the merge diff. Only T3 remains: real-browser QA of both blog posts (the zero line included), which no task has actually run yet — QA recorded "blocked" on both T2 and T5.

## Gate

- `typecheck`: `cd web && npm run typecheck`
- `racing-state`: `cd web && npx tsx --test scripts/tests/racing-state.test.ts`
- `adapter`: `cd web && npm run test:adapter`
- `figures-recipes-test`: `cd web && { [ ! -f scripts/tests/figures-recipes.test.mjs ] || node --test scripts/tests/figures-recipes.test.mjs; }`
- `race-trace-export-test`: `cd web && npx tsx --test scripts/tests/race-trace-export.test.ts`
- `monza-figures`: `tmp=$(mktemp -d) || exit 1; cp -R analyst/2026_1293/figures "$tmp/fig" || { rm -rf "$tmp"; exit 1; }; trap 'rm -rf analyst/2026_1293/figures; mv "$tmp/fig" analyst/2026_1293/figures; rm -rf "$tmp"' EXIT; (cd web && node scripts/analyst/figures.mjs --meeting 2026_1293 --verify)`
- `brief-bounds`: `d=analyst/2026_1293_gpt6; [ ! -d "$d" ] && exit 0; w=$(sed 1d "$d/report.md" | wc -w); { [ "$w" -ge 900 ] && [ "$w" -le 1400 ]; } || { echo "report.md is $w words (brief: 900-1400)"; exit 1; }; n=$(ls "$d"/figures/*.json 2>/dev/null | wc -l); { [ "$n" -ge 3 ] && [ "$n" -le 5 ]; } || { echo "$n compiled figures (brief: 3-5)"; exit 1; }`
- `gpt6-post`: `bash scripts/gate_gpt6_post.sh`
- `secret-files`: `! git diff main --name-only | grep -E '(^|/)\.env'`
- `audit`: `cd web && npm audit --omit=dev --audit-level=critical`

- [x] **T1** figures.mjs: recipes.mjs loader, binding-based strict verification, deterministic writes, tests — _done_ `tooling` `data` `tests`
    - AC: `cd web && node scripts/analyst/figures.mjs --meeting 2026_1293 --verify` exits 0 printing ✅ for gap_trace, closing_rate, strategy_split, charge, AND leaves `git status --porcelain -- analyst/2026_1293` empty — including charge.json, whose committed nulls exercise the NaN/null normalization
    - AC: Compiling an external-recipe meeting twice produces byte-identical figure files (including a series with a missing point); a genuine content change still rewrites
    - AC: `cd web && node --test scripts/tests/figures-recipes.test.mjs` passes all cases in Part D and leaves no `analyst/.tmp-*` directory behind
    - AC: Strict mode fails with a named problem on: uncovered/unknown-shape series, length-mismatched sources, coherently shifted lap arrays (lap_path_template mismatch), mixed-lap inputs operands, NaN with finite resolvable sources, misspelled/nonexistent packet paths, unbound decoration text, annotation-lap binding mismatch, tampered racing_state, wrong gantt stop label or non-packet stint bounds, and a windowed (non-grid-prefixed) position_changes series; NaN against an explicitly-null packet field passes
    - AC: Built-in Monza recipes are verified exactly as before (no strict mode), and external-recipe meetings compile ONLY their own figures
    - AC: `cd web && npm run typecheck`, the racing-state test, and `npm run test:adapter` pass; `bash scripts/gate_gpt6_post.sh` exits 0 (skip path)
- [x] **T2** Author the GPT-6 Monza post: full analyst/2026_1293_gpt6/ package + pipeline run — _done_ (after T1) `data` `docs` `ui` `tooling`
    - AC: `bash scripts/gate_gpt6_post.sh` exits 0 in the worktree: all seven files present, packet byte-identical, figures verify under strict mode, draft verifies, style lint passes, post builds with slug monza-2026-gpt6, ≥3 PNGs, and `git diff main` is clean for all Do-not-touch paths
    - AC: The body is 900–1400 words (`sed '1d' report.md | wc -w`) and there are 3–5 compiled figure JSONs — the toml gate's brief-bounds step enforces these exactly
    - AC: `node scripts/analyst/figures.mjs --meeting 2026_1293_gpt6 --verify` prints ✅ for every recipe with zero problems; every chart type is one of race_trace, position_changes, line_with_stint_markers, stint_gantt; every series carries its lap binding; every decoration and coordinate is slot-bound; any position_changes figure is full-race grid-prefixed
    - AC: `recipes.mjs` contains no numeric literals inside any `derive.inputs` array and no digit-bearing `const` slots — every displayed number traces to packet paths
    - AC: `node scripts/analyst/verify_draft.mjs --dir ../analyst/2026_1293_gpt6` prints VERIFY: PASS (warnings acceptable, failures not); no `attributed:` ref names a source outside the packet's own record; the body contains no word-form quantities standing in for numbers
    - AC: `node scripts/corpus/style_lint.mjs ../analyst/2026_1293_gpt6/report.md` exits 0
    - AC: `web/content/blog/monza-2026-gpt6.json` exists with the title from report.md line 1, author "GPT-6 Astra (orchestra)", and a hero_figure that is one of the compiled figures; every numeric fact in the dek has a sidecar claim
    - AC: report.md argues its own thesis (notes.md names it, its packet paths, and a per-material-causal-claim self-review) and shares no paragraph with `analyst/2026_1293/report.md`
    - AC: The full toml gate sequence passes in the worktree; `git status --porcelain -- analyst/2026_1293` is empty after the pipeline runs
- [ ] **T3** Browser QA of /blog/monza-2026-gpt6 with per-renderer assertions and PNG inspection — _pending_ (after T2, T5) `ui` `frontend` `tests` `docs`
    - AC: `analyst/2026_1293_gpt6/qa.md` exists, lists checks 1–5 each with URL, assertion, and PASS (or defect + fix), and contains one visual-inspection line per exported PNG including lap-range, racing-state, and zero-line observations (and a note of the pre-existing title header, recorded not fixed)
    - AC: Page HTML of `/blog/monza-2026-gpt6` contains zero `{{fig:` literals; wrapper count equals placeholder count; each of the three race_trace figures shows >0 data marks, x-ticks spanning its declared lap window, and the labelled zero ReferenceLine; no unsupported/no-data fallback text anywhere
    - AC: All three figures render at their bare figure routes under the same assertions, and each PNG is served 200/image/png at >10 KB AND visually shows plotted data with racing-state shading and the zero line
    - AC: `/blog` lists both posts; `/blog/monza-2026` passes the per-renderer assertions for its four figures (strategy_split asserted as a gantt, not as SVG; gap_trace/charge show no stray reference line); `git diff main` remains clean for all Do-not-touch paths
    - AC: `bash scripts/gate_gpt6_post.sh` and the full toml gate sequence still pass in the worktree; no throwaway QA scripts or screenshots are committed
- [ ] **T4** Harden scripts/gate_gpt6_post.sh to the brief (bounds, figure count, recipes test, env guard) — _pending_ (after T1) **[needs human]** `tooling` `tests` `security`
    - AC: Not applicable — superseded by the committed orchestra.toml gate.
- [x] **T5** Render horizontal_marker in RaceTraceChart and re-export the gpt6 PNGs — _done_ (after T2) `frontend` `ui` `tests`
    - AC: `git diff main --name-only` contains exactly: `web/src/components/f1-chat/charts/race-trace-chart.tsx`, `web/scripts/tests/race-trace-export.test.ts`, the three PNGs under `web/public/blog/monza-2026-gpt6/`, and the three PNGs under `analyst/2026_1293_gpt6/figures/` — no JSON, no other source files
    - AC: `cd web && npx tsx --test scripts/tests/race-trace-export.test.ts` passes: all pre-existing assertions plus, per gpt6 figure, exactly one ReferenceLine at y=0 carrying the label "Level at the line" from the figure JSON, and zero ReferenceLine elements for `analyst/2026_1293/figures/gap_trace.json`
    - AC: Each regenerated PNG in `web/public/blog/monza-2026-gpt6/` is >10 KB and was visually opened to confirm a labelled horizontal zero line with the gap traces crossing it (per the alt text); the same three PNGs are refreshed in `analyst/2026_1293_gpt6/figures/`
    - AC: The full gate passes in the worktree: typecheck, racing-state test, adapter test, figures-recipes test, monza-figures verify (with `git status --porcelain -- analyst/2026_1293` empty after), brief-bounds, `bash scripts/gate_gpt6_post.sh`, secret-files
    - AC: `git diff main` is clean for `analyst/2026_1293/**`, `web/content/blog/monza-2026.json`, and `web/public/blog/monza-2026/**`
