# F1 Insights — design review & redesign kit (2026-07-03)

Everything Claude Design needs to redesign the app's answer cards, organized. Dark theme, official F1
team colors, cards ~760px desktop / ~380px mobile.

## Folder map
```
design-review-2026-07-03/
├── README.md                 ← you are here
├── DESIGN_REVIEW.md          ← every card type graded (A–F) + redesign notes
├── RUBRIC.md                 ← the 6 design dimensions used to grade
├── CLAUDE_DESIGN_PROMPTS.md  ← ready-to-paste redesign prompts (worst-first)
├── DESIGN_SYSTEM_BRIEF.md    ← seed brief for a "vNext" design system (tokens, rules, gates)
├── shots/                    ← 20 real card screenshots (before/current state)
│   └── INDEX.md              ← maps each screenshot → chart type → grade → prompt
└── track-maps/               ← all 24 real 2025 circuit outlines (PNG + SVG)
    └── _manifest.json        ← round → venue → point count
```

## How to use each with Claude Design
- **shots/** — the *current* cards. Attach the relevant one when asking for a redesign (e.g.
  `06_grouped_bar.png` for the corner-delta redesign). Grades + problems per card in `shots/INDEX.md`.
- **track-maps/** — **24 individual circuit outlines**, one file per venue, named by calendar round
  (`01_melbourne` … `24_yas_marina`). Use these instead of the combined calendar poster — Claude Design
  reads single images far better. **These are the app's REAL geometry** (traced from each circuit's
  fastest-lap `raw.location` telemetry), so mockups built on them will match production. `.png` for
  visual reference, `.svg` for accurate vector reuse. White outline on near-black, red start/finish dot,
  mono label — already on-brand.
  - For the **status_grid** redesign (a per-venue coverage grid) these 24 files ARE the grid assets.
  - For **corner-delta / brake-zones / speed-map** mockups, hand Claude Design the specific circuit
    (e.g. `13_spa.png`) so it draws the true shape, not an approximation.
- **CLAUDE_DESIGN_PROMPTS.md** — paste-ready prompts, worst-graded first (grouped_bar → status_grid →
  stacked → degradation → donut). Each says where a track mini-map fits and where it doesn't.
- **DESIGN_SYSTEM_BRIEF.md** — paste when creating the vNext **Design System** (model: Fable 5). Encodes
  the two-layer token rule (semantic UI tokens vs domain colors that stay raw hex), the contracts to
  preserve (`ChartSeries.color`/`strokeDasharray`, the honesty UI), and the ship gates.

## Recommended flow
1. Create the vNext Design System in Claude Design (Fable 5) from `DESIGN_SYSTEM_BRIEF.md` + the mockups.
2. Redesign cards worst-first using `CLAUDE_DESIGN_PROMPTS.md`, attaching the matching `shots/` image and
   any needed `track-maps/` circuit(s).
3. Export via `</>` → hand back to Claude Code to normalize into `globals.css` / `tailwind.config.ts` /
   components, with the gates, verified live.

## Provenance / regen
- Screenshots: captured live from the real `/api/chat` pipeline (not `/mock`).
- Track maps: `web/scripts/export_track_outlines.mjs` (direct-to-Neon; replicates
  `/api/track-outline`'s reference-lap pick). Re-run to refresh: `node scripts/export_track_outlines.mjs`.
