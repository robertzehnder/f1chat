# Phase 26 Analysis Categories + Visualization Plan — 2026-05-05 (rev0)

**Purpose**: enumerate every analysis surface this app supports (the
deployed Phase 21 / Phase 26 matviews + the core synthesis paths
that work today), the visualization shape that fits each, and a
copy-pasteable mock prompt + response for each so the UI can be
mocked outside this dev environment.

**Mock JSON contract**: each category's "sample response" is shaped
to match what the new `InsightCard` consumes plus a `chart` block
that the card already auto-detects from the result rows. Mocks can
be dropped into a fixture file (e.g. `web/src/__mocks__/insights.ts`)
and rendered via `<InsightCard {...mock} />`.

```ts
type InsightMock = {
  title: string;             // header (red dot + bold)
  subtitle?: string;         // venue · session · year
  body: string;              // narrative paragraph
  metrics?: { label: string; value: string; unit?: string; emphasis?: boolean }[];
  chart?: ChartSpec;         // optional viz block (see per-category)
  key_takeaways?: string[];  // bullet-dashed list under chart
  related_questions?: string[];
  sql?: string;              // collapsible for transparency
  rows?: Record<string, unknown>[]; // table that powers the metrics/chart
};
```

---

## Category 1 — Corner Analysis

**Data sources**: `analytics.corner_analysis` (Phase 26.2a) ×
`f1.track_segments` (corner zones).

**What it answers**:
- "What was X driver's apex speed at Turn N?" (single-driver, single-corner)
- "Compare X and Y through Eau Rouge" (multi-driver, single-corner)
- "Across the Suzuka esses (T7-T9) where did X gain on Y?" (multi-driver, multi-corner)

**Best visualization**: **grouped bar chart**, X = corner, Y = speed (km/h),
one bar per driver, bar color = driver's 2025 team palette. For single-corner
single-driver, fall back to **3-tile metric grid** (entry / apex / exit).

**Sample prompt**:
> Compare Verstappen and Hamilton through the Suzuka esses (Turns 7-9) at the 2025 Japanese GP — entry, apex, exit

**Sample response mock**:
```json
{
  "title": "Suzuka Esses Comparison",
  "subtitle": "2025 Japanese GP · Race",
  "body": "Across the Suzuka esses (Turns 7-9) at the 2025 Japanese GP, Verstappen (Red Bull) carried consistently higher entry and apex speeds at Turns 7 and 8, while Hamilton (Ferrari) was marginally quicker through Turn 9. At Turn 7, Verstappen averaged 232.6 km/h entry vs Hamilton's 227.3 km/h — a ~5 km/h entry advantage. At Turn 8 (Degner 1), Verstappen led with 247.6 km/h entry vs 241.8 km/h. Turn 9 (Degner 2) flipped slightly in Hamilton's favour.",
  "chart": {
    "type": "grouped_bar",
    "x_axis": ["T7", "T8", "T9"],
    "y_label": "Entry speed (km/h)",
    "series": [
      { "name": "Max Verstappen", "values": [195, 248, 264], "color": "#1E41FF" },
      { "name": "Lewis Hamilton", "values": [188, 232, 263], "color": "#DC0000" }
    ]
  },
  "key_takeaways": [
    "Verstappen +5 km/h on average entry speed at Turns 7 & 8",
    "Hamilton stronger on exit at Turn 9 (Degner 2)",
    "53 laps analyzed for statistical confidence",
    "Red Bull's downforce setup favors high-speed entry"
  ],
  "related_questions": [
    "Show qualifying comparison",
    "Add Leclerc to comparison",
    "Analyze hairpin (Turn 11)"
  ],
  "rows": [
    { "driver_name": "Max VERSTAPPEN", "corner_label": "Turn 7 (Esses)", "corner_number": 7, "entry_speed_kph": 195, "apex_min_speed_kph": 188, "exit_speed_kph": 215 },
    { "driver_name": "Lewis HAMILTON", "corner_label": "Turn 7 (Esses)", "corner_number": 7, "entry_speed_kph": 188, "apex_min_speed_kph": 184, "exit_speed_kph": 210 },
    { "driver_name": "Max VERSTAPPEN", "corner_label": "Turn 8 (Degner 1)", "corner_number": 8, "entry_speed_kph": 248, "apex_min_speed_kph": 175, "exit_speed_kph": 245 },
    { "driver_name": "Lewis HAMILTON", "corner_label": "Turn 8 (Degner 1)", "corner_number": 8, "entry_speed_kph": 232, "apex_min_speed_kph": 172, "exit_speed_kph": 240 },
    { "driver_name": "Max VERSTAPPEN", "corner_label": "Turn 9 (Degner 2)", "corner_number": 9, "entry_speed_kph": 264, "apex_min_speed_kph": 185, "exit_speed_kph": 268 },
    { "driver_name": "Lewis HAMILTON", "corner_label": "Turn 9 (Degner 2)", "corner_number": 9, "entry_speed_kph": 263, "apex_min_speed_kph": 187, "exit_speed_kph": 270 }
  ]
}
```

---

## Category 2 — Lap Pace & Fastest Lap

**Data sources**: `core.laps_enriched`, `core.stint_summary`,
`analytics.fuel_corrected_pace`.

**What it answers**:
- "What was the fastest lap of the 2025 Italian GP?"
- "How did Hamilton's first-stint pace compare to Russell at Monza?"
- "Show clean-air pace evolution across stints"

**Best visualization**: **line chart**, X = lap number, Y = lap time (sec),
one line per driver (team color). Overlay a horizontal "race fastest"
marker. For aggregate lap-pace comparisons, use a 2-tile metric grid
(driver A best / driver B best) + delta.

**Sample prompt**:
> How did Hamilton's race pace compare to Russell across the first stint at Monza 2025?

**Sample response mock**:
```json
{
  "title": "First Stint Pace — Monza 2025",
  "subtitle": "2025 Italian GP · Race",
  "body": "Across his first stint at Monza 2025 (laps 1-22 on the medium compound), Hamilton (Ferrari) averaged 83.95s per lap with a best of 82.88s, marginally quicker than Russell (Mercedes) who averaged 84.31s with a best of 83.41s. Hamilton's pace advantage of ~0.36s/lap reflects Ferrari's straight-line speed at Monza.",
  "metrics": [
    { "label": "Hamilton Avg", "value": "83.95", "unit": "sec/lap" },
    { "label": "Russell Avg", "value": "84.31", "unit": "sec/lap" },
    { "label": "Delta", "value": "+0.36", "unit": "sec/lap", "emphasis": true }
  ],
  "chart": {
    "type": "line",
    "x_label": "Lap",
    "y_label": "Lap time (s)",
    "series": [
      { "name": "Lewis Hamilton", "values": [83.5, 82.9, 83.1, 83.0, 83.4, 83.8, 84.0, 84.2, 84.3, 83.7, 83.9, 84.1, 84.0, 84.2, 84.4, 84.5, 84.3, 84.1, 84.0, 84.2, 84.4, 84.6], "color": "#DC0000" },
      { "name": "George Russell", "values": [84.0, 83.4, 83.6, 83.8, 84.0, 84.2, 84.3, 84.5, 84.6, 84.0, 84.2, 84.4, 84.3, 84.5, 84.7, 84.8, 84.6, 84.4, 84.3, 84.5, 84.7, 84.9], "color": "#27F4D2" }
    ]
  },
  "key_takeaways": [
    "Hamilton averaged 83.95s vs Russell 84.31s — 0.36s/lap quicker",
    "Both on the medium compound for the first stint",
    "Hamilton's best lap of 82.88s was the stint's overall fastest",
    "Pace delta consistent across the 22-lap stint (no degradation gap)"
  ],
  "related_questions": [
    "Show fuel-corrected pace",
    "Compare second-stint pace",
    "Add Leclerc and Antonelli"
  ]
}
```

---

## Category 3 — Tyre Strategy (stints + compounds + warmup)

**Data sources**: `core.stint_summary`, `analytics.tyre_warmup`,
`analytics.stint_degradation_curve`.

**What it answers**:
- "What compound did X start on?"
- "How many laps until tyres reached target temperature?"
- "Compare medium-compound deg curves between McLaren and Red Bull"

**Best visualization**: **stint Gantt strip** (one row per driver, colored
segments per compound: hard=white, medium=yellow, soft=red, inter=green,
wet=blue). Below the Gantt: a 2-tile grid for compound count + total laps.
For deg-curve questions: **scatter + regression line** of lap times
within a stint.

**Sample prompt**:
> Compare medium-compound deg curves between McLaren and Red Bull in stint 2 at Jeddah 2025

**Sample response mock**:
```json
{
  "title": "Medium-Compound Stint 2 Degradation",
  "subtitle": "2025 Saudi Arabian GP · Race",
  "body": "In their second stint on the medium compound at Jeddah 2025, McLaren ran a slightly more aggressive deg profile than Red Bull. Norris (McLaren) averaged 0.142 s/lap of degradation across his 18-lap stint; Verstappen (Red Bull) showed 0.118 s/lap across 19 laps. The 0.024 s/lap gap (~0.5s over the stint) is consistent with Red Bull's more conservative tyre management at high-fuel conditions.",
  "metrics": [
    { "label": "Norris Deg", "value": "0.142", "unit": "s/lap" },
    { "label": "Verstappen Deg", "value": "0.118", "unit": "s/lap" },
    { "label": "Delta", "value": "+0.024", "unit": "s/lap", "emphasis": true }
  ],
  "chart": {
    "type": "scatter_with_regression",
    "x_label": "Stint lap",
    "y_label": "Lap time (s)",
    "series": [
      { "name": "Lando Norris", "points": [[1, 91.2], [2, 90.8], [3, 90.9], [4, 91.0], [5, 91.1], [6, 91.3], [7, 91.4], [8, 91.5], [9, 91.6], [10, 91.7], [11, 91.8], [12, 92.0], [13, 92.1], [14, 92.3], [15, 92.4], [16, 92.5], [17, 92.7], [18, 92.8]], "color": "#FF8000", "slope": 0.142 },
      { "name": "Max Verstappen", "points": [[1, 91.5], [2, 91.0], [3, 91.1], [4, 91.2], [5, 91.3], [6, 91.4], [7, 91.4], [8, 91.5], [9, 91.6], [10, 91.7], [11, 91.7], [12, 91.8], [13, 91.9], [14, 92.0], [15, 92.0], [16, 92.1], [17, 92.2], [18, 92.3], [19, 92.4]], "color": "#1E41FF", "slope": 0.118 }
    ]
  },
  "key_takeaways": [
    "McLaren's medium-compound deg ~0.024 s/lap higher than Red Bull",
    "Both teams ran 18-19 lap stints — comparable workload",
    "Red Bull's flatter curve suggests cooler tyre management",
    "Stint-end pace gap of ~0.5s favors Red Bull's strategy"
  ],
  "related_questions": [
    "Show fuel-corrected pace",
    "Compare hard-compound stints",
    "Add Ferrari to comparison"
  ]
}
```

---

## Category 4 — Pit Strategy & Stop Performance

**Data sources**: `analytics.pit_loss_per_circuit`,
`analytics.undercut_overcut_history`, `core.strategy_summary`,
`raw.pit`.

**What it answers**:
- "What was the pit-loss penalty at the 2025 Belgian GP?"
- "Did Russell's covering stop on Verstappen succeed?"
- "Compare pit-stop deltas across the SC window at Bahrain"

**Best visualization**: **horizontal bar chart** of pit_loss_s per driver,
sorted ascending. Highlight bars where action_status was "free" (under SC).
For undercut/overcut: **stacked bar** (success / fail / neutral counts).

**Sample prompt**:
> What was the pit-loss penalty for an extra stop at the 2025 Belgian Grand Prix?

**Sample response mock**:
```json
{
  "title": "Pit Loss — Spa-Francorchamps 2025",
  "subtitle": "2025 Belgian GP · Race",
  "body": "At the 2025 Belgian GP, the average pit-loss across all stops was 22.4 seconds. Verstappen's stops were the cleanest (avg 21.2s), Hamilton's were slightly costlier (avg 23.1s) due to a slow rear-left changeover on his second stop. The fastest single stop was Norris's first at 20.9s; the slowest was Stroll's at 26.3s after a wheelnut hesitation.",
  "metrics": [
    { "label": "Avg Pit Loss", "value": "22.4", "unit": "sec" },
    { "label": "Fastest Stop", "value": "20.9", "unit": "sec", "emphasis": true },
    { "label": "Slowest Stop", "value": "26.3", "unit": "sec" }
  ],
  "chart": {
    "type": "horizontal_bar",
    "y_axis": ["Verstappen", "Norris", "Leclerc", "Russell", "Piastri", "Hamilton", "Sainz", "Alonso", "Stroll"],
    "x_label": "Pit loss (s) — average across stops",
    "series": [
      { "name": "Pit Loss", "values": [21.2, 21.5, 21.8, 22.1, 22.4, 23.1, 23.4, 24.0, 26.3], "colors": ["#1E41FF", "#FF8000", "#DC0000", "#27F4D2", "#FF8000", "#DC0000", "#1868DB", "#229971", "#229971"] }
    ]
  },
  "key_takeaways": [
    "Average pit loss at Spa: 22.4s",
    "Verstappen's stops were the cleanest (21.2s avg)",
    "Stroll's slowest stop cost 5.4s vs the field average",
    "Two stops on a high-deg compound is the optimal strategy"
  ],
  "related_questions": [
    "Compare to Hungary 2025 pit loss",
    "Show undercut success rate",
    "Pit stops under safety car"
  ]
}
```

---

## Category 5 — Restart & Lap-1 Performance

**Data sources**: `analytics.restart_performance`,
`core.race_progression_summary`, `raw.starting_grid`.

**What it answers**:
- "Who gained the most positions on the lap-1 launch?"
- "What was Russell's position before/after the SC restart?"
- "Compare lap-1 vs lap-2 position gain for Russell and Antonelli"

**Best visualization**: **horizontal bar chart**, X = position_delta
(positions gained, with negative on left), one bar per driver, sorted
by delta. Color by team. Center line at 0.

**Sample prompt**:
> Who gained the most positions on the lap-1 launch at the 2025 Bahrain GP?

**Sample response mock**:
```json
{
  "title": "Lap-1 Launch — Bahrain 2025",
  "subtitle": "2025 Bahrain GP · Race",
  "body": "On the lap-1 launch at the 2025 Bahrain GP, Sainz (Williams) gained the most positions, advancing 4 places from P14 on the grid to P10 by the end of lap 1. Antonelli (Mercedes) and Hülkenberg (Sauber) each gained 3. The biggest losers were Stroll (lost 3 positions, P9 → P12) and Bortoleto (lost 2).",
  "metrics": [
    { "label": "Biggest Gainer", "value": "+4", "unit": "Sainz", "emphasis": true },
    { "label": "Biggest Loser", "value": "-3", "unit": "Stroll" },
    { "label": "Avg Movement", "value": "1.8", "unit": "positions" }
  ],
  "chart": {
    "type": "horizontal_bar_diverging",
    "y_axis": ["Sainz", "Antonelli", "Hülkenberg", "Hadjar", "Albon", "Verstappen", "Norris", "Hamilton", "Russell", "Leclerc", "Piastri", "Tsunoda", "Bortoleto", "Stroll"],
    "x_label": "Positions gained (lap 1)",
    "series": [
      { "name": "Position Δ", "values": [4, 3, 3, 2, 1, 0, 0, 0, 0, -1, -1, -1, -2, -3], "colors": ["#1868DB", "#27F4D2", "#52E252", "#6692FF", "#1868DB", "#1E41FF", "#FF8000", "#DC0000", "#27F4D2", "#DC0000", "#FF8000", "#1E41FF", "#52E252", "#229971"] }
    ]
  },
  "key_takeaways": [
    "Sainz gained 4 positions — best of the field",
    "Mercedes drivers split: Antonelli +3, Russell flat",
    "Stroll lost the most (-3), dropping from P9 to P12",
    "Front row converted cleanly: Verstappen and Norris held position"
  ],
  "related_questions": [
    "Show lap-2 settling pattern",
    "Compare to lap-1 at Australia 2025",
    "What about SC restart on lap 35?"
  ]
}
```

---

## Category 6 — Overtaking & DRS Battles

**Data sources**: `analytics.overtake_events`,
`analytics.drs_effectiveness`, `raw.overtakes`.

**What it answers**:
- "How many overtakes happened at Singapore 2025?"
- "Who had the most overtakes in the closing 10 laps?"
- "Did Norris's pass on Piastri rely on DRS?"

**Best visualization**: **horizontal bar** of overtake_count per driver.
For DRS share: a **donut/stacked-bar** showing DRS-active vs non-DRS
share per session. For lap-by-lap battles: a **timeline** marker chart.

**Sample prompt**:
> How many on-track overtakes happened during the 2025 Singapore Grand Prix?

**Sample response mock**:
```json
{
  "title": "On-Track Overtakes — Singapore 2025",
  "subtitle": "2025 Singapore GP · Race",
  "body": "The 2025 Singapore GP saw 47 on-track overtakes across 62 laps — significantly higher than recent Singapore races thanks to the new fourth DRS zone added for 2025. Norris led with 8 overtakes (recovering from a Q3 mistake), followed by Hamilton with 6 and Hülkenberg with 5. The bulk of overtakes (32 of 47) happened in the first DRS zone on the start-finish straight.",
  "metrics": [
    { "label": "Total Overtakes", "value": "47" },
    { "label": "Most by Driver", "value": "8", "unit": "Norris", "emphasis": true },
    { "label": "DRS-Aided", "value": "68%" }
  ],
  "chart": {
    "type": "horizontal_bar",
    "y_axis": ["Norris", "Hamilton", "Hülkenberg", "Sainz", "Antonelli", "Albon", "Russell", "Hadjar", "Stroll", "Bortoleto"],
    "x_label": "Overtakes",
    "series": [
      { "name": "Overtakes", "values": [8, 6, 5, 4, 4, 3, 3, 2, 2, 1], "colors": ["#FF8000", "#DC0000", "#52E252", "#1868DB", "#27F4D2", "#1868DB", "#27F4D2", "#6692FF", "#229971", "#52E252"] }
    ]
  },
  "key_takeaways": [
    "47 total overtakes — 2025's best Singapore figure",
    "Norris led recovery drive with 8 passes from P15 grid",
    "68% of overtakes were DRS-aided",
    "Fourth DRS zone (start-finish) accounted for most of the pickup"
  ],
  "related_questions": [
    "Where did the overtakes happen?",
    "Compare DRS zones 1-3 vs zone 4",
    "Show Norris's lap-by-lap recovery"
  ]
}
```

---

## Category 7 — Traffic & Clean-air Pace

**Data sources**: `analytics.traffic_adjusted_pace`, `raw.intervals`,
`core.laps_enriched`.

**What it answers**:
- "How many laps did Norris spend in clean air at Mexico 2025?"
- "What was Verstappen's traffic-adjusted pace at Singapore?"
- "How big was Mercedes' long-run pace advantage in clean air?"

**Best visualization**: **stacked horizontal bar** per driver — split
between clean_air_laps (light fill) and traffic_laps (darker). Plus a
metric tile for pace_delta.

**Sample prompt**:
> Across the 2025 season so far, who has spent the most laps in clean air vs traffic?

**Sample response mock**:
```json
{
  "title": "Clean Air vs Traffic — 2025 Season",
  "subtitle": "All Race sessions · 2025",
  "body": "Across the 2025 season so far, Verstappen leads in clean-air share with 412 laps in clean air vs 89 in traffic (82% clean). Norris is second at 78%. The midfield runners spent more than half their laps in traffic: Hülkenberg (61% traffic), Bortoleto (64% traffic), and Stroll (58% traffic). Clean-air pace correlates strongly with finishing position across the field.",
  "metrics": [
    { "label": "Most Clean-Air Laps", "value": "412", "unit": "Verstappen", "emphasis": true },
    { "label": "Avg Pace Delta", "value": "+0.42", "unit": "sec/lap" },
    { "label": "Drivers w/ ≥70% Clean", "value": "5" }
  ],
  "chart": {
    "type": "stacked_horizontal_bar",
    "y_axis": ["Verstappen", "Norris", "Piastri", "Russell", "Leclerc", "Hamilton", "Antonelli", "Sainz", "Albon", "Hülkenberg"],
    "x_label": "Laps",
    "series": [
      { "name": "Clean Air", "values": [412, 388, 372, 351, 341, 318, 287, 265, 232, 198], "color": "#A3A3A3" },
      { "name": "In Traffic", "values": [89, 110, 132, 153, 162, 184, 213, 240, 270, 308], "color": "#E10600" }
    ]
  },
  "key_takeaways": [
    "Verstappen led 82% of his laps in clean air",
    "Avg traffic pace penalty: +0.42 s/lap field-wide",
    "5 drivers maintained ≥70% clean-air share",
    "Backmarkers spent >55% of laps stuck behind another car"
  ],
  "related_questions": [
    "Show pace delta in traffic vs clean air",
    "Filter by stint",
    "Mexico 2025 specifically"
  ]
}
```

---

## Category 8 — Weather Impact

**Data sources**: `analytics.weather_impact`, `raw.weather`.

**What it answers**:
- "Was the 2025 Hungarian GP run wet or dry?"
- "On which lap did the McLarens make the inters-to-slicks crossover?"
- "How much pace did Mercedes give up to Red Bull on the wet?"

**Best visualization**: **dual-axis line chart** — primary Y = lap time,
secondary Y = rainfall mm/hr or track temp. Vertical markers at
crossover_lap. Highlight wet-tyre laps with shaded region.

**Sample prompt**:
> On which lap did the McLarens make the inters-to-slicks crossover at the 2025 British GP?

**Sample response mock**:
```json
{
  "title": "Inters-to-Slicks Crossover — Silverstone 2025",
  "subtitle": "2025 British GP · Race",
  "body": "At the 2025 British GP, both McLaren drivers made the intermediates-to-slicks crossover on lap 22, when track temperatures rose above 28°C and the dry line had fully developed. Norris pitted on lap 22 (transition to medium); Piastri followed on lap 23 (also medium). Their decision was 2 laps later than the leaders — a calculated bet that paid off when both moved up positions during the cycle.",
  "metrics": [
    { "label": "Norris Crossover", "value": "Lap 22", "emphasis": true },
    { "label": "Piastri Crossover", "value": "Lap 23" },
    { "label": "Wet Pace Delta", "value": "+8.2", "unit": "sec/lap" }
  ],
  "chart": {
    "type": "line_dual_axis",
    "x_label": "Lap",
    "y1_label": "Lap time (s)",
    "y2_label": "Rainfall (mm/hr)",
    "series": [
      { "name": "Norris (lap time)", "axis": "y1", "values": [98, 95, 92, 90, 89, 87, 86, 85, 85, 86, 87, 88, 89, 90, 91, 92, 93, 92, 91, 90, 89, 88, 84, 83, 83, 83, 83, 83], "color": "#FF8000" },
      { "name": "Piastri (lap time)", "axis": "y1", "values": [99, 96, 93, 91, 90, 88, 87, 86, 86, 87, 88, 89, 90, 91, 92, 93, 94, 93, 92, 91, 90, 89, 88, 84, 83, 83, 83, 83], "color": "#FFB266" },
      { "name": "Rainfall", "axis": "y2", "values": [3, 4, 4, 5, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "color": "#1868DB" }
    ],
    "vertical_markers": [
      { "x": 22, "label": "Norris pits → med" },
      { "x": 23, "label": "Piastri pits → med" }
    ]
  },
  "key_takeaways": [
    "Both McLarens crossed over on consecutive laps (22 / 23)",
    "Track temp passed 28°C threshold around lap 21",
    "McLaren's call was 2 laps later than the leader's",
    "Wet-tyre pace gap was +8.2 s/lap vs slick race pace"
  ],
  "related_questions": [
    "Show all teams' crossover laps",
    "Compare to 2024 Silverstone",
    "Wet-pace ranking by team"
  ]
}
```

---

## Category 9 — Stewards & Incidents

**Data sources**: `analytics.race_control_incidents`,
`raw.race_control`.

**What it answers**:
- "List FIA steward decisions involving a 5-second time penalty at Monza 2025"
- "How many penalty points were issued at São Paulo?"
- "Did the stewards apply consistent penalties for forcing-off?"

**Best visualization**: **timeline marker list** ordered by lap_number, with
each event shown as a card-style row (lap number, incident_kind tag,
action_status tag, driver, message excerpt). Or a **count grid** by
incident_kind for aggregate questions.

**Sample prompt**:
> List the FIA steward decisions that involved a 5-second time penalty during the 2025 Italian Grand Prix

**Sample response mock**:
```json
{
  "title": "5-Second Time Penalties — Monza 2025",
  "subtitle": "2025 Italian GP · Race",
  "body": "The 2025 Italian GP saw 4 five-second time penalties: Sainz (track limits, lap 12), Stroll (forcing-off, lap 28), Hülkenberg (track limits, lap 41), and Tsunoda (unsafe release, lap 47). The unsafe release for Tsunoda was the only stop-go-equivalent ruling; the other three were standard track-limits / racing-incident penalties. None of the four moved out of the points window after their penalty.",
  "metrics": [
    { "label": "Total 5-sec Penalties", "value": "4" },
    { "label": "Unique Drivers", "value": "4" },
    { "label": "Race Laps", "value": "53" }
  ],
  "chart": {
    "type": "timeline",
    "events": [
      { "lap": 12, "driver": "Sainz",       "kind": "track_limits",       "team_color": "#1868DB", "message": "5 SECOND TIME PENALTY FOR CAR 55 (SAI) — TRACK LIMITS" },
      { "lap": 28, "driver": "Stroll",      "kind": "forcing_off",        "team_color": "#229971", "message": "5 SECOND TIME PENALTY FOR CAR 18 (STR) — FORCING ANOTHER DRIVER OFF THE TRACK" },
      { "lap": 41, "driver": "Hülkenberg",  "kind": "track_limits",       "team_color": "#52E252", "message": "5 SECOND TIME PENALTY FOR CAR 27 (HUL) — TRACK LIMITS" },
      { "lap": 47, "driver": "Tsunoda",     "kind": "unsafe_release",     "team_color": "#1E41FF", "message": "5 SECOND TIME PENALTY FOR CAR 22 (TSU) — UNSAFE RELEASE" }
    ]
  },
  "key_takeaways": [
    "4 five-second penalties across 53 race laps",
    "Track limits accounted for 50% (2 of 4)",
    "Tsunoda's unsafe-release was the only pit-related penalty",
    "All 4 drivers stayed inside the points window after their penalty"
  ],
  "related_questions": [
    "Show drive-through penalties",
    "Stewards decisions by lap",
    "Compare to Monza 2024 incidents"
  ]
}
```

---

## Category 10 — Track Dominance (sectors + minisectors)

**Data sources**: `analytics.sector_dominance`,
`analytics.minisector_dominance`, `f1.track_segments`.

**What it answers**:
- "How many minisectors did Piastri lead at Zandvoort 2025?" *(seed-gap: blocked at Zandvoort)*
- "Which corners did X gain on Y through Sector 2 at Silverstone?"
- "Compare Q2 vs Q3 minisector dominance"

**Best visualization**: **track-shape-aware heatmap** — render the
circuit map (SVG) and color each minisector segment by which driver
dominated that segment most. Fallback: **stacked bar** per sector
showing minisector_count per driver.

**Sample prompt**:
> Which corners did Verstappen gain on Norris through Sector 2 at Silverstone 2025?

**Sample response mock**:
```json
{
  "title": "Sector 2 Minisector Dominance — Silverstone 2025",
  "subtitle": "2025 British GP · Qualifying",
  "body": "Through Silverstone Sector 2 in qualifying 2025, Verstappen dominated 14 of 22 minisectors vs Norris's 8. Verstappen's strongest gains came at Maggotts (T10), Becketts (T11), and Chapel (T12) — the high-speed esses where Red Bull's downforce balance excelled. Norris reclaimed time through the Stowe complex (T15-T16) where McLaren's lower-drag setup helped.",
  "metrics": [
    { "label": "Verstappen", "value": "14", "unit": "minisectors", "emphasis": true },
    { "label": "Norris", "value": "8", "unit": "minisectors" },
    { "label": "Total", "value": "22" }
  ],
  "chart": {
    "type": "track_heatmap",
    "circuit": "Silverstone",
    "sector": 2,
    "segments": [
      { "minisector_index": 23, "name": "T9 Copse",     "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 24, "name": "T9 Copse",     "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 25, "name": "T10 Maggotts", "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 26, "name": "T10 Maggotts", "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 27, "name": "T11 Becketts", "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 28, "name": "T11 Becketts", "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 29, "name": "T12 Chapel",   "leader": "Verstappen", "color": "#1E41FF" },
      { "minisector_index": 30, "name": "T13 Hangar",   "leader": "Norris",     "color": "#FF8000" },
      { "minisector_index": 31, "name": "T15 Stowe",    "leader": "Norris",     "color": "#FF8000" },
      { "minisector_index": 32, "name": "T16 Stowe",    "leader": "Norris",     "color": "#FF8000" }
    ]
  },
  "key_takeaways": [
    "Verstappen 14, Norris 8 — Verstappen +6 net minisectors",
    "Verstappen dominated the high-speed esses (Maggotts→Chapel)",
    "Norris reclaimed Stowe complex (T15-T16) by ~0.08s",
    "Sector 2 net delta: Verstappen ahead by 0.18s overall"
  ],
  "related_questions": [
    "Show Sector 1 dominance",
    "Compare Q2 vs Q3",
    "Add Leclerc to comparison"
  ]
}
```

---

## Category 11 — Straight-line Speed

**Data sources**: `analytics.straight_line_dominance` (per-(session,
driver) speed-trap proxies via 90th / 95th percentile speeds + MAX).

**What it answers**:
- "What was Verstappen's top speed through the speed trap at Monza 2025 qualifying?"
- "Compare Norris and Verstappen on i1 vs speed-trap at Jeddah"
- "Did Mercedes hold straight-line advantage at Baku?"

**Best visualization**: **horizontal bar chart**, X = speed (km/h), one
bar per driver, sorted descending. For multi-trap comparisons: a
**grouped bar** with i1 / i2 / st as series (3 grouped bars per driver).

**Sample prompt**:
> What was Verstappen's top speed through the speed trap at Monza 2025 qualifying?

**Sample response mock**:
```json
{
  "title": "Speed Trap — Monza 2025 Qualifying",
  "subtitle": "2025 Italian GP · Qualifying",
  "body": "Through the Monza 2025 qualifying speed trap, Verstappen recorded a top speed of 358.4 km/h on his Q3 lap, the field's third-fastest. Sainz (Williams) led the trap at 362.1 km/h thanks to Williams's low-drag Monza package; Antonelli (Mercedes) was second at 360.7. Verstappen's combination of cornering and straight-line speed was nonetheless the quickest overall, securing pole.",
  "metrics": [
    { "label": "Verstappen ST", "value": "358.4", "unit": "km/h" },
    { "label": "Field Best", "value": "362.1", "unit": "Sainz", "emphasis": true },
    { "label": "Field Avg", "value": "351.2", "unit": "km/h" }
  ],
  "chart": {
    "type": "horizontal_bar",
    "y_axis": ["Sainz", "Antonelli", "Verstappen", "Albon", "Norris", "Russell", "Hamilton", "Piastri", "Tsunoda", "Leclerc"],
    "x_label": "Speed-trap top speed (km/h)",
    "series": [
      { "name": "ST speed", "values": [362.1, 360.7, 358.4, 357.9, 357.1, 356.4, 355.8, 355.2, 354.6, 354.0], "colors": ["#1868DB", "#27F4D2", "#1E41FF", "#1868DB", "#FF8000", "#27F4D2", "#DC0000", "#FF8000", "#1E41FF", "#DC0000"] }
    ]
  },
  "key_takeaways": [
    "Sainz topped the trap at 362.1 km/h with Williams's low-drag package",
    "Verstappen 3rd fastest at 358.4 km/h",
    "Field spread of 8.1 km/h reflects setup variance",
    "Verstappen took pole despite not topping the trap"
  ],
  "related_questions": [
    "Show i1 / i2 trap speeds",
    "Race-trim vs qualifying-trim ST speed",
    "Compare to Baku 2025"
  ]
}
```

---

## Category 12 — Driver Performance (7-axis season aggregator)

**Data sources**: `analytics.driver_performance_score` (Phase 21
Tier 4) — qualifying / race-pace / tyre-management / restart /
traffic-handling / overtake-difficulty / error-rate axes.

**What it answers**:
- "What's Verstappen's tyre-management axis rating for 2025?"
- "Where does X's edge over Y come from — qualifying or race-pace?"
- "Rank drivers by error-rate axis"

**Best visualization**: **radar chart** (7 axes, one polygon per
driver, team-colored line + filled translucent area). For 2-driver
comparisons: overlay 2 polygons.

**Note**: qualifying_axis and race_pace_axis are currently 0 across
all drivers because raw.starting_grid + raw.session_result are
empty for 2025 (manifest entry q2161/q2162). Mock below assumes
the data gap is closed.

**Sample prompt**:
> Compare Verstappen and Norris across all 7 performance axes for the 2025 season

**Sample response mock**:
```json
{
  "title": "7-Axis Performance — Verstappen vs Norris 2025",
  "subtitle": "2025 Season · Aggregate",
  "body": "Across the seven Phase 21 performance axes, Verstappen leads Norris in qualifying (88 vs 82), tyre management (76 vs 71), and error-rate (95 vs 88). Norris leads in overtake-difficulty (78 vs 64) — reflecting his recovery drives from grid incidents. Race-pace and traffic-handling are roughly even. Verstappen's polygon is more uniform; Norris's shows a strength in attack at the cost of qualifying gap.",
  "chart": {
    "type": "radar",
    "axes": ["qualifying", "race_pace", "tyre_management", "restart", "traffic_handling", "overtake_difficulty", "error_rate"],
    "series": [
      { "name": "Max Verstappen", "values": [88, 90, 76, 75, 80, 64, 95], "color": "#1E41FF" },
      { "name": "Lando Norris",   "values": [82, 88, 71, 100, 78, 78, 88], "color": "#FF8000" }
    ]
  },
  "key_takeaways": [
    "Verstappen leads on qualifying (+6), tyre management (+5), error-rate (+7)",
    "Norris leads on overtake-difficulty (+14) — recovery-drive bias",
    "Restart axis: Norris 100 vs Verstappen 75",
    "Both top-tier in race-pace (90 / 88)"
  ],
  "related_questions": [
    "Add Piastri to comparison",
    "Show season trend per axis",
    "Where does Norris gain on Verstappen?"
  ]
}
```

---

## Category 13 — Braking & Traction

**Data sources**: `analytics.braking_performance`,
`analytics.traction_analysis`, `core.car_data_lap_position`.

**What it answers**:
- "What was X's brake-zone speed drop into Turn N?"
- "Compare exit traction at Y across drivers"
- "Where did X lose lap time — entry, apex, or exit?"

**Best visualization**: **dual-bar grouped chart** per corner —
brake_zone_speed_drop_kph (left) + exit_throttle_application_pct
(right). Or for single-corner deep-dive: **3-tile metric grid**
(approach / min / drop).

**Sample prompt**:
> What was Verstappen's brake-zone speed drop into Turn 22 in Saudi Arabia 2025 long runs?

**Sample response mock**:
```json
{
  "title": "Turn 22 Brake-Zone Performance — Saudi 2025",
  "subtitle": "2025 Saudi Arabian GP · Race",
  "body": "Across 41 race laps, Verstappen approached Turn 22 at an average of 318 km/h and braked down to 92 km/h — a brake-zone speed drop of 226 km/h. Peak brake pressure averaged 92.4%. The drop was consistent across the stint (std-dev 4.2 km/h), suggesting Red Bull's brake balance held up well as fuel burned off.",
  "metrics": [
    { "label": "Approach Speed", "value": "318", "unit": "km/h" },
    { "label": "Min in Brake Zone", "value": "92", "unit": "km/h" },
    { "label": "Speed Drop", "value": "226", "unit": "km/h", "emphasis": true }
  ],
  "chart": {
    "type": "line",
    "x_label": "Lap",
    "y_label": "Brake-zone speed drop (km/h)",
    "series": [
      { "name": "Verstappen drop", "values": [225, 228, 224, 227, 226, 230, 226, 225, 228, 224, 226, 229, 227, 226, 225, 224, 226, 228, 230, 227, 225, 224, 226, 228, 226, 230, 227, 225, 224, 226, 228, 226, 225, 227, 226, 228, 227, 225, 224, 226, 228], "color": "#1E41FF" }
    ]
  },
  "key_takeaways": [
    "Avg brake-zone speed drop: 226 km/h",
    "Peak brake pressure: 92.4%",
    "Std-dev across stint: 4.2 km/h (consistent)",
    "Brake balance stable as fuel burned off"
  ],
  "related_questions": [
    "Compare to Hamilton at Turn 22",
    "Show all braking zones at Saudi",
    "Race-trim vs quali-trim brake drop"
  ]
}
```

---

## Category 14 — Data Health & Coverage

**Data sources**: `core.session_completeness`,
`analytics.telemetry_coverage_per_driver`.

**What it answers**:
- "Which 2025 sessions are missing telemetry coverage?"
- "Which sessions have weather data but no car data?"
- "Per-driver telemetry coverage at session X?"

**Best visualization**: **status grid** — rows = sessions, columns
= data sources (laps / car_data / location / weather / pit), cells
colored by coverage_score (green = full, yellow = partial, red =
missing). For per-driver views: similar grid with driver_number
rows.

**Sample prompt**:
> Across the 2025 season, which sessions have telemetry but no matching weather data?

**Sample response mock**:
```json
{
  "title": "Telemetry-Weather Coverage Gap — 2025",
  "subtitle": "All sessions · 2025",
  "body": "Across the 2025 season, 8 sessions show full car-data coverage but missing or partial weather data. The gap concentrates at Lusail (Qatar Sprint + Race both at 0 weather rows) and Mexico City (Race + Qualifying both partial). The reverse gap (weather but no telemetry) appears in 3 sessions, all early-season practice sessions where the car-data ingest pipeline was paused.",
  "metrics": [
    { "label": "Telemetry-only Gap", "value": "8", "unit": "sessions" },
    { "label": "Weather-only Gap", "value": "3", "unit": "sessions" },
    { "label": "Full Coverage", "value": "109", "unit": "sessions" }
  ],
  "chart": {
    "type": "status_grid",
    "rows": [
      { "session_key": 9836, "label": "Lusail Qualifying", "car_data": "full", "weather": "missing", "laps": "full" },
      { "session_key": 9839, "label": "Lusail Sprint",     "car_data": "full", "weather": "missing", "laps": "full" },
      { "session_key": 9850, "label": "Lusail Race",       "car_data": "full", "weather": "missing", "laps": "full" },
      { "session_key": 9877, "label": "Mexico Race",       "car_data": "full", "weather": "partial", "laps": "full" },
      { "session_key": 9873, "label": "Mexico Qualifying", "car_data": "full", "weather": "partial", "laps": "full" }
    ],
    "legend": {
      "full":    "#22C55E",
      "partial": "#F59E0B",
      "missing": "#EF4444"
    }
  },
  "key_takeaways": [
    "Lusail (Qatar) entirely missing weather rows — 3 sessions affected",
    "Mexico City has partial weather (lap-by-lap incomplete)",
    "3 early-season practice sessions: weather present, telemetry paused",
    "Full coverage on 109 of 120 sessions (90.8%)"
  ],
  "related_questions": [
    "Per-driver telemetry coverage",
    "Show session_completeness scores",
    "Compare to 2024 coverage"
  ]
}
```

---

## Section 15 — Implementation roadmap (UI side)

**Phase A (1 day; foundational)**
- Extend `InsightCard` with a new optional `chart` prop accepting the
  shapes above (`grouped_bar`, `line`, `horizontal_bar`,
  `horizontal_bar_diverging`, `stacked_horizontal_bar`,
  `line_dual_axis`, `timeline`, `track_heatmap`, `radar`,
  `scatter_with_regression`, `status_grid`).
- Build a per-shape SVG renderer module
  (`web/src/components/chart/`) — keep dependencies zero (no
  recharts) since the shapes are simple. Each renderer ≤ 80 LoC.

**Phase B (1-2 days; per-category fixtures)**
- Drop the 14 mocks above into
  `web/src/__mocks__/insights/{category}.ts`.
- Build a `/mock` route in the app that renders all 14 mocks in a
  scrollable column for design review.
- Each fixture imports the team-color registry — no hard-coded
  hexes.

**Phase C (1 day; LLM-side hint extension)**
- Extend `MATVIEW_HINTS` in `web/src/lib/anthropic.ts` to include
  a `recommended_chart` annotation per matview.
- Have the synthesis prompt emit a structured `chart` block in the
  JSON response when the recommended_chart shape is supported.
- `mapChatApiResponseToParts` parses the new chart block into a
  `MessagePart` of type `chart` that `AssistantMessage` forwards
  to `InsightCard`.

**Phase D (0.5 day; polish)**
- Auto-detection in `InsightCard.deriveCornerChart()` extends to
  the other shapes (e.g. detect `position_delta` rows and auto-
  emit `horizontal_bar_diverging`).
- Hover tooltips on every chart shape.
- Empty-state copy per category when the matview is shipped but
  has no rows for the requested filter.

**Effort total**: 3-4 days for full coverage. Mocks alone (Phase
B without renderers) can ship in 1 day and unblock external
design feedback.

---

## Section 16 — Quick reference table

| # | Category | Primary matview | Best chart | Manifest gap? |
|---|---|---|---|---|
| 1 | Corner Analysis | analytics.corner_analysis | grouped_bar / 3-tile | seed gap (5 venues) |
| 2 | Lap Pace | core.laps_enriched + fuel_corrected_pace | line | none |
| 3 | Tyre Strategy | stint_summary + tyre_warmup + stint_degradation_curve | gantt + scatter | none |
| 4 | Pit Strategy | pit_loss_per_circuit + undercut_overcut_history | horizontal_bar | none |
| 5 | Restart & Lap-1 | restart_performance | horizontal_bar_diverging | raw.session_result empty |
| 6 | Overtaking & DRS | overtake_events + drs_effectiveness | horizontal_bar + donut | DRS per-lap simplified |
| 7 | Traffic & Clean Air | traffic_adjusted_pace | stacked_horizontal_bar | none |
| 8 | Weather Impact | weather_impact | line_dual_axis | none |
| 9 | Stewards & Incidents | race_control_incidents | timeline | penalty_points NULL |
| 10 | Track Dominance | sector_dominance + minisector_dominance | track_heatmap | seed gap (Zandvoort, LV) |
| 11 | Straight-line Speed | straight_line_dominance | horizontal_bar | none |
| 12 | Driver Performance | driver_performance_score (7-axis) | radar | qual/race axes 0 |
| 13 | Braking & Traction | braking_performance + traction_analysis | dual_bar grouped | none |
| 14 | Data Health | session_completeness + telemetry_coverage | status_grid | none |

---

**Filename note**: this file lives at
`diagnostic/phase26_analysis_categories_plan_2026-05-05.md`.
The 14 mocks above are reference fixtures; once Phase B ships
the in-repo `web/src/__mocks__/insights/` set, this file
should link to those fixtures rather than embed JSON inline.
