# T3 browser QA — 2026-09-09

Overall: **BLOCKED**, not a browser PASS. No browser page assertions completed.

Started `cd web && npm run dev -- --port 3101` (Next.js reported ready), and attempted a throwaway script using the installed `@playwright/test` Chromium, following `export_figures.mjs`: headless launch, 1240 × 900 viewport, device scale 2, dark scheme. Chromium failed at launch, before any navigation:

```
FATAL:base/apple/mach_port_rendezvous_mac.cc:159
Check failed: kr == KERN_SUCCESS.
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.71372:
Permission denied (1100)
```

This execution sandbox disallows requesting elevated execution. The script and gate output are scratch files in `/tmp/t3-browser-qa/`, not committed. No browser screenshots were produced. The dev server also reported Watchpack `EMFILE: too many open files, watch`; its output included 404 responses for `/` and `/blog/monza-2026-gpt6` from requests outside the failed script. These are additional runtime observations, not completed browser checks or a diagnosed application defect. The dev server was stopped with Ctrl-C and exited successfully.

## Checks 1–5

1. **BLOCKED — http://localhost:3101/blog**. Prepared assertions: HTTP 200; links to both `/blog/monza-2026` and `/blog/monza-2026-gpt6`, with each title and dek visible. Not executed because Chromium could not launch.

2. **BLOCKED — http://localhost:3101/blog/monza-2026-gpt6**. Prepared assertions: title matches `report.md` line 1; dek and `GPT-6 Astra (orchestra)` visible; three `[data-figure]` wrappers matching the three `post.md` placeholders; zero literal `{{fig:` strings in response HTML and hydrated HTML; caption text visible below each chart. Each race trace must contain SVG series marks (`path`/`circle`/`line` within `.recharts-line`), x-tick endpoints matching its JSON `lap_numbers`, and a dashed `3 3` ReferenceLine labelled `Level at the line`, horizontally aligned with the zero y-axis tick. Windows: `early_lead_exchange` 11–24, `unequal_recoveries` 27–53, `mclaren_finish` 43–53. None of these DOM assertions ran.

   Read `charts/index.tsx`, `line-hardening.tsx`, `no-data-card.tsx`, and the relevant renderers before preparing fallback assertions. Exact unsupported template: `Chart type "{chart.type}" not yet implemented`; no-data strings: `The metric can't be computed — here's why, honestly` and `What we can answer instead`. The script rejects these on the whole page. `line-hardening.tsx` supplies notes rather than an empty-state string; empty race-trace/position series return null, so wrapper existence alone cannot prove rendering. Fallback absence remains unverified in a browser.

3. **BLOCKED — bare figure routes**. For each URL below, prepared HTTP 200, visible `[data-export-root]`, exactly one expected figure inside it, the same SVG/window/zero-line/fallback assertions as check 2, and a visible caption. None ran.
   - http://localhost:3101/blog/monza-2026-gpt6/figure/early_lead_exchange
   - http://localhost:3101/blog/monza-2026-gpt6/figure/unequal_recoveries
   - http://localhost:3101/blog/monza-2026-gpt6/figure/mclaren_finish

4. **HTTP PASS; visual inspection PARTIAL / clipping FAIL**. Used Python `urllib.request` against the running server, independently of the failed browser script. Opened all three existing `web/public/blog/monza-2026-gpt6/*.png` files with the image viewer; these are actual visual observations, not inferred from sizes. No PNGs were regenerated.

   | URL | HTTP | Content-Type | Bytes (>10 KB) |
   | --- | --- | --- | --- |
   | http://localhost:3101/blog/monza-2026-gpt6/early_lead_exchange.png | 200 | image/png | 122171 |
   | http://localhost:3101/blog/monza-2026-gpt6/unequal_recoveries.png | 200 | image/png | 160739 |
   | http://localhost:3101/blog/monza-2026-gpt6/mclaren_finish.png | 200 | image/png | 102296 |

   - **early_lead_exchange.png — visual PASS:** turquoise and blue plotted curves present across labelled laps 11–24; dashed zero line and `Level at the line` visible; no caution shading, consistent with the figure JSON's empty racing-state periods/sector flags for this window; axes, legend and caption have no observed edge clipping. Pre-existing article-title header is present above the figure, recorded and not removed.
   - **unequal_recoveries.png — visual FAIL on clipping:** turquoise and blue curves present across labelled laps 27–53; amber `VSC L28–29` shaded band with dashed boundaries and yellow sector marks present; dashed zero line and `Level at the line` visible. The small sector-lane label at the far right is truncated (visible beginning `sector yellows (issue…`); therefore the “nothing clipped at the edges” assertion does not pass. Main axes, plotted curves and caption are visible. Pre-existing article-title header is present above the figure, recorded and not removed. No fix made: the affected racing-state layer is explicitly frozen/do-not-touch in this task; a permitted follow-up and browser verification are needed.
   - **mclaren_finish.png — visual PASS:** orange curve present across labelled laps 43–53; dashed zero line and `Level at the line` visible; no caution shading, consistent with the figure JSON's empty racing-state periods/sector flags for this window; axes, legend and caption have no observed edge clipping. Pre-existing article-title header is present above the figure, recorded and not removed.

   The requirement for racing-state shading is conditional on caution periods: only `unequal_recoveries` declares them. Adding shading to the other two would misrepresent their supplied data.

5. **BLOCKED — http://localhost:3101/blog/monza-2026**. Prepared assertions: four wrappers; `gap_trace` (race_trace, laps 20–53), `closing_rate` (line_with_stint_markers, laps 40–48) and `charge` (position_changes, grid/lap 0–53) have SVG series marks and ticks spanning their windows. Source clarification: `charge` is actually `position_changes`, not `race_trace`, and has no `lap_numbers`; its renderer maps index 0 to grid. Both `gap_trace` and `charge` declare no horizontal marker; the script checks absence of horizontal ReferenceLines and the new label while allowing vertical annotations. For `strategy_split`, prepared HTML/CSS assertions: exactly eight driver rows matching `y_axis`, at least one positive-width bar per row with a compound-palette background, all five rendered compound legend entries (hard/medium/soft/inter/wet), and no SVG requirement. No regression browser assertion ran.

## Gates and scope

Executed the complete `[gate]` setup and command sequence from `orchestra.toml` in order using Bash, including the existing-figure backup/restore wrapper. Every command exited 0:

- setup: PASS (existing dependencies; no install or lockfile changes).
- `npm run typecheck`: PASS.
- racing-state: PASS, 13 tests.
- `npm run test:adapter`: PASS, 36 tests.
- figures-recipes-test: PASS, 15 tests.
- monza-figures verification: PASS; original figures restored by the prescribed trap.
- brief-bounds: PASS.
- `bash scripts/gate_gpt6_post.sh`: PASS, including figure verification, draft verification, style lint, build, and three-PNG checks.
- secret-files: PASS.

The post gate changed only the generated post's `provenance.built_at` timestamp; restored that file to HEAD after inspecting the diff. No application or article fix was made. Final scope check: only this QA report is changed; `git diff main` is clean for all do-not-touch paths. Scratch scripts and images are not included in the diff.

To complete T3, rerun the Chromium assertions in an environment that permits browser launch, resolve the server's observed route/watch behavior if it persists, and obtain an allowed resolution for the clipped frozen-layer label. Gates passing and existing PNGs rendering do not establish that either blog post passes real-browser QA.
