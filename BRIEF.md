# Brief for this orchestra run — GPT-6 writes its own Monza 2026 post

## Read first (source of truth, in this order)
1. `analyst/2026_1293/packet.json` — the canonical evidence packet for the 2026 Italian Grand Prix
   (session 11361): results, grid penalties, stints, stops (caution-classified), position trace,
   `pair_gaps` (line-crossing gaps), lead changes, racing-state intervals, race-control events with
   typed links, candidate moments, anomaly windows, data-quality manifest. Every factual claim in
   the new post must resolve to a path in this file. No database access is needed or allowed.
2. `analyst/2026_1293/ledger.md` — how the existing analysis reasoned from the packet (read it to
   understand the evidence; do NOT copy its conclusions or wording).
3. `corpus/style/composite_voice_v2_narrative.md` and `corpus/style/content_contract.md` — the
   target register: a flowing analytical article, result and hinge up front, nested layers of
   observation → correction → mechanism → consequence, caveats folded mid-sentence, third person,
   forward-leaning close. `corpus/style/phrasing_method.md` lists machine-prose tells to avoid.
4. `diagnostic/visuals_and_blog_plan_2026-09-09.md` — the figure and verification rules: captions
   are templates with typed slots bound to packet paths; every number on a figure must resolve to
   the packet; only self-contained chart types are publishable; the racing-state grammar.
5. The pipeline you must use, in `web/scripts/analyst/`: `figures.mjs` (packet → figures with
   slot-bound captions, `--verify`), `build_post.mjs` (article + figures → `web/content/blog/<slug>.json`,
   with fail-closed gates), `export_figures.mjs` (PNGs via the bare figure route), `verify_draft.mjs`
   (prose numbers/claims against the packet, `--dir`), and `web/scripts/corpus/style_lint.mjs`.
6. `analyst/2026_1293/report.md` is the EXISTING article of record, published at `/blog/monza-2026`.
   Read it only to make sure your piece is genuinely different: your own thesis, structure and
   sentences. Do not paraphrase it. If the packet supports a different reading of the race, argue it.

## Scope: build a second, independent Monza 2026 post authored by GPT-6
Create `analyst/2026_1293_gpt6/` containing:
- `packet.json` — a copy of `analyst/2026_1293/packet.json` (unchanged; it is the evidence).
- `report.md` — your article (900–1,400 words, `#` title first line), written from the packet in the
  target register. Every number, position, lap, tyre compound and quoted race-control message must
  be traceable to a packet path; causes that the packet cannot establish must be attributed or
  withheld (the packet records "VSC DEPLOYED", not why). No invented quotes. No claims about what
  people thought or felt.
- `sidecar.json` — the claim map `verify_draft.mjs` expects (see the existing
  `analyst/2026_1293/sidecar.json` for the shape: numbered claims with `packet_path`, `type`
  (`packet_fact` | `derived_metric` | `attribution`), `values`, and the exact prose span).
- `recipes.mjs` — 3 to 5 figure recipes of your own design. Extend `figures.mjs` so it loads
  `analyst/<meeting>/recipes.mjs` when present (keeping the built-in Monza recipes working
  unchanged), and make sure each recipe's caption/alt uses the slot mechanism so `--verify` passes.
  Reuse the existing chart types (`race_trace`, `position_changes`, `line_with_stint_markers`,
  `stint_gantt`, …) and the racing-state layer; add a renderer feature only if a figure genuinely
  needs it, with tests kept green.
- `post.md` (= `report.md` plus `{{fig:name}}` placeholder lines) and `post.meta.json`
  (`slug: "monza-2026-gpt6"`, `author: "GPT-6 Astra (orchestra)"`, a one-sentence `dek`,
  `hero_figure`, `published_at`).
- `notes.md` — one page: your thesis and why the packet supports it, what you deliberately did
  differently from the existing post, and any packet limitation you hit.

Then run the pipeline end to end: `figures.mjs --meeting 2026_1293_gpt6 --verify`,
`build_post.mjs --meeting 2026_1293_gpt6`, `verify_draft.mjs --dir ../analyst/2026_1293_gpt6`,
`style_lint.mjs` on the report, and `export_figures.mjs --slug monza-2026-gpt6 --base <endpoint url>`
against the dev server declared in `orchestra.toml`, so `web/public/blog/monza-2026-gpt6/*.png` exist.
The post must render at `/blog/monza-2026-gpt6` and appear on `/blog`.

## Do not touch
- `analyst/2026_1293/` (the existing evidence and article), `web/content/blog/monza-2026.json`,
  `web/public/blog/monza-2026/`.
- Database, migrations (`sql/`), anything that needs Neon credentials; `web/.env.local` (never read
  or print secrets).
- The racing-state visual grammar in `web/src/components/f1-chat/charts/racing-state-layer.tsx`
  (reviewed and frozen); the chat route (`web/src/app/api/chat/`).
- Corpus source text (`corpus-artifacts/`, `corpus/inbox/`): never copy or quote it.

## Done means
The gate in `orchestra.toml` is green in the task worktree; `/blog/monza-2026-gpt6` renders with its
figures and PNG exports; `verify_draft`, `style_lint`, `figures --verify` and `build_post` all pass for
the new meeting directory; the existing `monza-2026` figures still verify; `notes.md` explains the
piece. Nothing in "Do not touch" changed.
