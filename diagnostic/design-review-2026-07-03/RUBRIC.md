# Design-review grading rubric — F1 Insights chart surface

Purpose: grade the CURRENT visual design of every card type the app generates through the
LIVE pipeline (not `/mock`), so Claude Design can verify and redesign. This is a **design/UX**
review — not data correctness (that's separately A-graded).

## Six dimensions, each scored 1–5
1. **Clarity of message** — is the "so what" obvious at a glance? Does the headline/verdict/tiles
   deliver the answer before the chart is even read?
2. **Legibility** — axis labels, ticks, legend, value labels readable at card width; no overlap,
   clipping, truncation, or off-scale points. Dark-theme contrast adequate.
3. **Visual hierarchy** — title → key metric → chart → detail; the eye is guided, not lost.
4. **Aesthetic / brand fit** — feels like a purpose-built F1 product (team colors, typographic
   polish, spacing), not a default Recharts dump.
5. **Information density** — right amount of information; not sparse (wasted space) nor cluttered.
6. **Distinctiveness / craft** — bespoke feel where it counts (track maps, race trace, gantt) vs
   generic bar/line where a richer treatment is possible.

## Overall letter grade (per visual)
- **A** — ship-quality; a designer would keep it.
- **B** — solid, minor polish (labels, spacing, color).
- **C** — communicates but looks generic / has a clear weakness.
- **D** — functional but visually poor or confusing.
- **F** — broken/blank/misleading as rendered.

Each visual entry carries: what-it-shows, the live prompt used, the six sub-scores, overall grade,
strengths, and **redesign opportunities** (the actionable part for Claude Design).

## Scope note
Grades reflect the card AS RENDERED LIVE on a desktop card (~760px wide, dark theme). Client-fetch
charts (telemetry, track maps) are graded after their dense payload populates. Two follow-up
fixtures (M07 team-grouped bar, M23 marker map) are not implemented and are out of scope.
