# F1 Insights — vNext Design System brief (paste into Claude Design → Design systems, model: Fable 5)

Seed a NEW named design system ("F1 Insights vNext") from the approved mockups (corner-delta,
status_grid ALL-CLEAR circuit grid, clean-air timeline) PLUS these rules. Use the app's real theming as
the implementation contract — do not invent token names; keep the shadcn semantic layer, change values
underneath, and add the new aliases.

## Aesthetic direction (from the mockups)
Near-black surfaces; F1-red primary + amber as the second accent; **monospace for labels/eyebrows**
(uppercase, wide tracking, e.g. "ANSWER AT A GLANCE", "REASONING & QUERY") + a **grotesk for headlines
and big numbers**; generous metric tiles as the answer-at-a-glance element; the **real-circuit track-map
motif** wherever data is spatial; subtle 1px borders; skeleton/loading states; honest "considered vs
recommended" panels when a richer viz isn't backed by data.

## Token architecture (HARD rules)
**Two layers — do not mix them:**
1. **Semantic UI tokens (theme).** Keep the existing shadcn names; change values, add aliases. Baseline
   (dark-only; `:root` and `.dark` are identical today — keep it dark-only unless we decide otherwise):
   - `--background: 285 5% 13%` · `--card: 285 5% 17%` · `--popover: 285 5% 17%`
   - `--primary: 2 100% 44%` (F1 red) · `--secondary: 285 5% 22%` · `--muted: 285 5% 22%`
   - `--border: 285 5% 28%` · `--input: 285 5% 22%` · `--ring: 2 100% 44%` · `--radius: 0.75rem`
   - **ADD:** `--surface-raised`, `--accent-amber`, `--semantic-positive`, `--semantic-negative`,
     `--chart-grid`, `--section-label`, motion tokens (`--dur-fast/med`, easing).
   - Fonts: `--font-mono` already exists (Geist Mono). The decision to make: keep Geist or swap the
     grotesk/mono pairing — propose one, don't just "add a token."
2. **Domain colors (DATA — never tokenize).** Team primary+secondary, tyre-compound (S/M/H), status
   colors live in `f1-team-colors.ts` as **raw hex** and are passed straight into SVG/Recharts via
   `ChartSeries.color`. Do NOT alias these into Tailwind. Consolidate the duplicated local copies that
   some chart components currently define (stint-gantt, status-grid) back into `f1-team-colors.ts`.

## Must-preserve contracts
- `ChartSeries` carries `color` (raw string) + `strokeDasharray` / `strokeWidth` / `opacity` / `emphasis`
  (recently added for teammate distinction + full-field dimming) — keep these.
- The **honesty UI is product surface, not decoration**: reasoning trace, collapsible SQL, result-row
  table, no-data/refusal cards, clarification cards, truncation + streaming states. Style them, keep them.
- Sweep the **inline hardcoded F1-red** (`#E10600` in insight-card, metric-grid, timeline-chart, chart
  markers) onto the token — else the system is cosmetic.

## Component recipes to codify
InsightCard shell (title → eyebrow reasoning trace → answer-at-a-glance → tiles → chart → takeaways →
SQL → table) · MetricGrid tile · section-label (mono uppercase) · chart chrome (grid/axis/legend) ·
skeleton/loading · no-data & clarification honesty cards · track-mini-map card (spatial data only).

## Gates before ship
Contrast checks for red/amber/team colors on near-black · `prefers-reduced-motion` for skeletons/motion ·
screenshot review across all chart types · confirm dark-only.

## Deliverable back to the repo (for the `</>` handoff)
Token table (exact HSL for UI vars / hex for domain) · alias map current→vNext · component recipes ·
migration checklist preserving the `ChartSeries` contract + honesty UI.
