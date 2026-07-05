# Screenshot index — design-review cards (2026-07-03)

20 full-card screenshots you captured while scrolling the live thread, copied here and renamed by
**thread position + chart type**. Filenames are `NN_type.png` where `NN` is the card's position in the
27-card thread — so gaps in the numbering (13, 19, 20, 24–27) are the cards **not captured** (listed at
the bottom, regenerate from the prompts in [../DESIGN_REVIEW.md](../DESIGN_REVIEW.md)). Grades are from
that review.

| File | Chart type | Grade | Prompt used |
|---|---|---|---|
| `01_hero.png` | hero (scalar) | A− | How many pit stops did Norris make at the Hungary 2025 race? |
| `02_verdict_stint_gantt.png` | verdict + stint_gantt | A | Did Mercedes split strategies between Russell and Hamilton at Spa 2025? |
| `03_metric_grid.png` | metric_grid (tiles) | B+ | What were the entry, apex and exit speeds for Leclerc through Turn 1 at Monaco 2025? |
| `04_horizontal_bar.png` | horizontal_bar | A− | How many on-track overtakes did the 2025 Imola Grand Prix produce, and who made the most? |
| `05_horizontal_bar_diverging.png` | horizontal_bar_diverging | A− | On the lap-1 launch at Australia 2025, did Norris or Verstappen gain more positions? |
| `06_grouped_bar.png` | grouped_bar | B → **C** | Compare Hamilton and Leclerc's average entry speed through each corner at Spa 2025. |
| `07_stacked_horizontal_bar.png` | stacked_horizontal_bar | B | How many clean-air laps versus traffic laps did Piastri and Leclerc each run at Hungary 2025? |
| `08_line.png` | line | B+ | How did Hamilton's lap times compare to Russell across the opening stint at Monza 2025? |
| `09_stint_delta.png` | line_with_stint_markers | A− | Across stints 1, 2 and 3 at Bahrain 2025, did Hamilton's medium-stint deltas to Leclerc reverse on the hard? |
| `10_pace_cliff.png` | line_with_stint_markers | A− | Did Verstappen hit a pace cliff in his opening stint at Bahrain 2025? |
| `11_degradation_curve.png` | degradation_curve | B | Show the compound degradation curves at Qatar 2025. |
| `12_wet_crossover_dual_axis.png` | line_dual_axis | A− | What was the inter-to-slick crossover lap for the McLarens at Australia 2025? |
| `14_race_trace.png` | race_trace | A | Show the race trace and gap-to-leader evolution for the Canada 2025 Grand Prix. |
| `15_position_changes.png` | position_changes | A− | Show the race position changes and recovery drives at Imola 2025. |
| `16_pit_event_strip.png` | pit_event_strip | B+ | What was Verstappen's first-stop lap number in the 2025 Canadian Grand Prix? |
| `17_event_timeline.png` | event_timeline | B → B+ | What penalties and safety-car periods happened at the 2025 Saudi Arabian Grand Prix? |
| `18_radar.png` | radar | B+ | Where does Verstappen's edge over Norris come from in 2025 — qualifying axis or race-pace axis? |
| `21_track_speed_map.png` | track_speed_map | A (standout) | Show the speed map of Norris's fastest lap at Silverstone 2025 — the fastest and slowest sections. |
| `22_telemetry_overlay.png` | telemetry_overlay | A− | Overlay the fastest-lap telemetry for Verstappen and Norris at Silverstone 2025. |
| `23_status_grid.png` | status_grid | C+ → B | Which 2025 sessions have telemetry but no matching weather data, and where is the gap concentrated? |

## New finding from the screenshots (not in the earlier review)
- **`06_grouped_bar.png` has a real y-axis bug** — the tick labels render as garbage hex-like values
  (`454545`, `999999`) instead of speeds. Drops its grade to **C**. Add to the redesign list.
- **`23_status_grid.png` renders better than first graded** — a clean session × telemetry × weather grid
  ("full/full" cells) with a "30+ sessions · 0 missing" summary; nudge toward **B**.
- **`17_event_timeline.png` is nicer than first graded** — lap-numbered incident rows with driver chips
  and penalty tags; nudge toward **B+**.

## Not captured (7 cards) — regenerate from ../DESIGN_REVIEW.md prompts if you want them
- **13 · scatter_with_regression** (B−; the self-titled-with-raw-prompt bug)
- **19 · track_heatmap** (A) — mini-sector dominance ribbon
- **20 · track_corner_delta** (A) — brake-zone corner highlights on the circuit
- **24 · donut** (F) — renders prose only, no chart (dead path)
- **25 · no_data / refusal** (B+) — "Not in dataset"
- **26 · clarification** (B+) — sprint-weekend qualifying disambiguation
- **27 · composite** (B) — crossover × spin × pit multi-section

Full per-visual grades, strengths and redesign notes: [../DESIGN_REVIEW.md](../DESIGN_REVIEW.md).
Rubric: [../RUBRIC.md](../RUBRIC.md).
