# V0 Visualization Brief — F1 Insights chat response cards

**Audience**: v0 (or any external designer) tasked with producing
the missing chart renderers for the F1 Insights chat app.

**Context**: the app has 167 benchmark questions across 19 data
categories. Reading every question, the response shapes collapse
into **18 distinct visualization patterns** plus several notable
sub-variants that deserve their own mock. The chat already renders
text/SQL/result-table parts and has one chart type built (corner
grouped-bar). This brief enumerates the **23 mocks v0 should
design**, with sample prompt + structured response JSON per mock.

**Existing in repo** (reference, do not redesign):
- `web/src/components/chat/InsightCard.tsx` — card shell (red
  status dot, title, subtitle, body, metric tiles, chart slot,
  warnings, related-questions, collapsible SQL, result table)
- `web/src/lib/teamColors.ts` — 2025 team palette (use these hexes,
  do not invent colors)

**Mock contract** (every mock below conforms):

```ts
type InsightMock = {
  title: string;
  subtitle?: string;
  body: string;
  metrics?: { label: string; value: string; unit?: string; emphasis?: boolean }[];
  chart?: ChartSpec;
  key_takeaways?: string[];
  related_questions?: string[];
  sql?: string;
  rows?: Record<string, unknown>[];
};
```

**Team-color reference** (2025 grid — use these exactly):

```
Red Bull   #1E41FF   McLaren   #FF8000   Ferrari   #DC0000   Mercedes  #27F4D2
Aston Mart #229971   Alpine    #FF87BC   Williams  #1868DB   RB        #6692FF
Haas       #B6BABD   Sauber    #52E252   accent (F1 red) #E10600
```

---

## Visualization patterns at a glance

| # | Pattern | qids that need this shape | Distinct mock IDs below |
|---|---|---:|---|
| 1 | Hero scalar (one big number) | ~22 | M01 |
| 2 | Yes/no with evidence | ~14 | M02 |
| 3 | 3-tile metric grid | ~18 | M03 |
| 4 | 2-driver multi-corner grouped bar | ~16 | M04, M05 (built; redesign for braking/traction units) |
| 5 | Field-wide horizontal bar ranking | ~19 | M06, M07 |
| 6 | Stint Gantt strip (compound segments) | ~10 | M08 |
| 7 | Multi-line lap-time chart | ~14 | M09, M10 |
| 8 | Scatter + regression | ~6 | M11 |
| 9 | Lap-1 / restart diverging bar | ~7 | M12 |
| 10 | Stacked horizontal bar (clean/traffic) | ~6 | M13 |
| 11 | Dual-axis line chart | ~5 | M14 |
| 12 | Event timeline list (stewards) | ~7 | M15 |
| 13 | Track-shape minisector heatmap | ~9 | M16 |
| 14 | Radar (7-axis polygon) | ~8 | M17 |
| 15 | Status grid (data health) | ~8 | M18 |
| 16 | Donut / stacked share | ~3 | M19 |
| 17 | Multi-shape composite (cross-cat) | 9 | M20 |
| 18 | No-data refusal card | 9 | M21 |
| — | Pit-cycle event card (sub-variant of #2) | ~4 | M22 |
| — | Overtake-location track map (sub-variant of #13) | ~3 | M23 |

**Total mocks to produce: 23.**

---

## M01 — Hero scalar card

**When**: question asks for a single fact ("what was X's pole lap?",
"how many overtakes happened?", "what compound did X start on?").

**Layout**: huge centered number (≥48px), unit beneath, subtitle
above, narrative body below. NO chart, NO metric tiles. Optional
1-line context fact.

**Sample prompt** (qid 1922):
> What was Verstappen's pole lap time at Suzuka 2025?

```json
{
  "title": "Pole Lap — Suzuka 2025",
  "subtitle": "2025 Japanese GP · Qualifying Q3",
  "body": "Verstappen took pole at Suzuka 2025 with a lap of 1:27.502, 0.044s ahead of Norris in P2. The lap featured a personal-best Sector 2 through the high-speed esses where Red Bull's downforce package excelled.",
  "hero": {
    "value": "1:27.502",
    "label": "pole lap time",
    "context": "+0.044s ahead of Norris (P2)"
  },
  "key_takeaways": [
    "Sector 2 (esses) was the fastest of his stint",
    "Margin to P2 was the season's 4th-tightest pole",
    "Red Bull took pole at Suzuka in both 2024 and 2025"
  ],
  "related_questions": ["Show full Q3 lap times", "Compare to qualifying 2024", "Add Hamilton's best lap"]
}
```

---

## M02 — Yes / No with evidence

**When**: binary question with supporting facts ("was it wet or
dry?", "did the over-cut work?", "was X's stint cut short?").

**Layout**: huge "YES" or "NO" word in F1 red (#E10600) at top,
1-line answer subtitle, then 2-3 metric tiles supporting the verdict,
then narrative.

**Sample prompt** (qid 2062):
> Did Russell's covering stop on the lap after Verstappen in Canada 2025 successfully execute the over-cut?

```json
{
  "title": "Over-Cut Verdict — Canada 2025",
  "subtitle": "2025 Canadian GP · Race · lap 28-29",
  "verdict": {
    "label": "YES",
    "color": "#E10600",
    "summary": "Russell's lap-29 stop gained track position over Verstappen by 1.4s after the cycle"
  },
  "metrics": [
    { "label": "Gap before", "value": "1.8s", "unit": "Russell behind" },
    { "label": "Gap after",  "value": "1.4s", "unit": "Russell ahead", "emphasis": true },
    { "label": "Net swing",  "value": "+3.2s" }
  ],
  "body": "Russell pitted on lap 29, one lap after Verstappen's lap-28 stop. With Russell on fresher mediums and Verstappen still warming up his tyres on lap 30, Russell's out-lap was 1.1s quicker than Verstappen's in-lap, and the cycle handed Russell a 1.4s lead by the end of lap 30.",
  "key_takeaways": [
    "Russell's out-lap on fresh mediums was 1.1s faster than Verstappen's in-lap",
    "Net swing of +3.2s — clean execution by Mercedes",
    "Verstappen's tyre warm-up phase made the over-cut viable",
    "Track position held to the end of the stint"
  ]
}
```

---

## M03 — 3-tile metric grid (entry / apex / exit style)

**When**: single-driver-single-corner deep dive, before/after,
delta-with-context. The standard layout when there's a triplet.

**Sample prompt** (qid 1960):
> What was Verstappen's brake-zone speed drop into Turn 22 in Saudi Arabia 2025 long runs?

```json
{
  "title": "Turn 22 Brake-Zone — Saudi 2025",
  "subtitle": "2025 Saudi Arabian GP · Race",
  "body": "Across 41 race laps at Jeddah's Turn 22, Verstappen approached at an average of 318 km/h and braked down to 92 km/h — a brake-zone drop of 226 km/h with a peak brake pressure of 92.4%. Drop was consistent across the stint (std-dev 4.2 km/h).",
  "metrics": [
    { "label": "Approach", "value": "318", "unit": "km/h" },
    { "label": "Min in zone", "value": "92", "unit": "km/h" },
    { "label": "Drop",     "value": "226", "unit": "km/h", "emphasis": true }
  ],
  "key_takeaways": [
    "Peak brake pressure 92.4%",
    "Std-dev across the stint: 4.2 km/h (consistent)",
    "Brake balance held as fuel burned off",
    "Top-1 brake-zone severity at Jeddah"
  ]
}
```

---

## M04 — 2-driver multi-corner grouped bar (CORNER speeds)

**When**: comparing 2+ drivers across 2+ corners on entry / apex /
exit speed. Already built in `InsightCard.tsx` as `CornerBarChart`
— v0 can reuse the look.

**Sample prompt** (qid 1717):
> Across Turns 7, 8, 9 (Sector 2 high-speed esses) at Suzuka 2025, where did Verstappen lose time to Norris on entry vs apex?

```json
{
  "title": "Sector 2 Esses — Suzuka 2025",
  "subtitle": "2025 Japanese GP · Qualifying",
  "body": "Across Turns 7-9 at Suzuka, Norris held a small but consistent entry-speed advantage (~3 km/h average). Apex speeds flipped: Verstappen carried more apex speed at T8 (Degner 1) by 4 km/h. Net: Norris ahead through the esses by 0.06s.",
  "chart": {
    "type": "grouped_bar",
    "x_axis": ["T7", "T8 (Degner 1)", "T9 (Degner 2)"],
    "y_label": "Entry speed (km/h)",
    "series": [
      { "name": "Lando Norris",   "values": [232, 245, 261], "color": "#FF8000" },
      { "name": "Max Verstappen", "values": [229, 248, 264], "color": "#1E41FF" }
    ]
  },
  "key_takeaways": [
    "Norris +3 km/h average entry advantage",
    "Verstappen +4 km/h apex at T8 (Degner 1)",
    "Net delta: Norris ahead by 0.06s through Sector 2",
    "Sample: 8 hot laps each across Q1-Q3"
  ]
}
```

---

## M05 — 2-driver grouped bar (BRAKING / TRACTION variant)

**When**: same shape as M04 but the unit is brake-zone speed-drop
(km/h) or throttle-application percent. Different Y-label, different
color emphasis (use accent red on the worse-performing driver).

**Sample prompt** (qid 1969):
> Across the three heaviest brake zones at Bahrain 2025, did Piastri's lap-1 brake-zone delta to Norris foreshadow lap-pace deficit?

```json
{
  "title": "Heaviest Brake Zones — Bahrain 2025",
  "subtitle": "2025 Bahrain GP · Race · Lap 1",
  "body": "Across Bahrain's three heaviest braking zones (T1, T4, T10), Piastri's lap-1 brake-zone delta to Norris was +0.12s, +0.08s, and +0.05s respectively — and that pattern held across the opening stint, with Piastri averaging +0.09s/lap behind Norris through the deg curve.",
  "chart": {
    "type": "grouped_bar",
    "x_axis": ["T1", "T4", "T10"],
    "y_label": "Brake-zone delta to Norris (s)",
    "series": [
      { "name": "Lando Norris",  "values": [0.0, 0.0, 0.0], "color": "#FF8000" },
      { "name": "Oscar Piastri", "values": [0.12, 0.08, 0.05], "color": "#FFB266" }
    ]
  },
  "key_takeaways": [
    "Piastri trailed in all 3 heaviest brake zones",
    "Lap-1 deltas predicted stint-1 pace deficit (~0.09s/lap)",
    "Largest gap at T1 — heaviest braking zone",
    "Pattern consistent through the stint"
  ]
}
```

---

## M06 — Field-wide horizontal-bar ranking (10-20 drivers)

**When**: ranking the field on one axis — top speed, overtake count,
lap-1 movement, stationary pit time. Sorted descending. Bars colored
by team, labels right of bar.

**Sample prompt** (qid 2080):
> How many on-track overtakes did the 2025 Imola Grand Prix produce?

```json
{
  "title": "On-Track Overtakes — Imola 2025",
  "subtitle": "2025 Emilia-Romagna GP · Race",
  "body": "The 2025 Imola GP produced 28 on-track overtakes across 63 laps. Norris led with 7 overtakes (Q3 grid penalty recovery), Hamilton had 5, Hülkenberg 4. The bulk of overtakes (18 of 28) happened in the Tamburello DRS zone.",
  "metrics": [
    { "label": "Total Overtakes", "value": "28" },
    { "label": "Top Driver",      "value": "Norris (7)", "emphasis": true },
    { "label": "DRS-Aided",       "value": "64%" }
  ],
  "chart": {
    "type": "horizontal_bar",
    "y_axis": ["Norris", "Hamilton", "Hülkenberg", "Sainz", "Albon", "Antonelli", "Hadjar", "Stroll", "Bortoleto", "Tsunoda"],
    "x_label": "Overtakes",
    "series": [
      { "name": "Overtakes", "values": [7, 5, 4, 3, 3, 2, 2, 1, 1, 0], "colors": ["#FF8000", "#DC0000", "#52E252", "#1868DB", "#1868DB", "#27F4D2", "#6692FF", "#229971", "#52E252", "#6692FF"] }
    ]
  },
  "key_takeaways": [
    "28 total — slightly above Imola's 5-year mean",
    "Norris recovered from a Q3 mistake with 7 overtakes",
    "Tamburello DRS zone produced 18 of 28",
    "64% DRS-aided"
  ]
}
```

---

## M07 — Field-wide ranking with team-color side-bar (variant of M06)

**When**: ranking but with stronger team identity emphasis (e.g.,
straight-line speed, where teammates pair). Add a left-edge color
strip per team to group teammates visually.

**Sample prompt** (qid 2000):
> What was Verstappen's top speed through the speed trap at Monza 2025 qualifying?

```json
{
  "title": "Speed Trap — Monza 2025 Qualifying",
  "subtitle": "2025 Italian GP · Q3",
  "body": "Verstappen recorded 358.4 km/h through the speed trap on his Q3 lap, third-fastest. Sainz (Williams, low-drag Monza package) led at 362.1 km/h; Antonelli (Mercedes) was second at 360.7.",
  "metrics": [
    { "label": "Verstappen ST", "value": "358.4", "unit": "km/h" },
    { "label": "Field Best",    "value": "362.1", "unit": "Sainz", "emphasis": true },
    { "label": "Field Avg",     "value": "351.2", "unit": "km/h" }
  ],
  "chart": {
    "type": "horizontal_bar_team_grouped",
    "y_axis": ["Sainz",       "Antonelli",  "Verstappen", "Albon",     "Norris",    "Russell",   "Hamilton",  "Piastri",   "Tsunoda",   "Leclerc"],
    "teams":  ["williams",    "mercedes",   "red_bull",   "williams",  "mclaren",   "mercedes",  "ferrari",   "mclaren",   "rb",        "ferrari"],
    "x_label": "Speed-trap top speed (km/h)",
    "series": [
      { "name": "ST speed", "values": [362.1, 360.7, 358.4, 357.9, 357.1, 356.4, 355.8, 355.2, 354.6, 354.0] }
    ]
  },
  "key_takeaways": [
    "Williams's low-drag Monza package took the trap",
    "Mercedes (Antonelli + Russell) split P2 / P6",
    "Verstappen took pole despite not topping the trap",
    "Field spread of 8.1 km/h"
  ]
}
```

---

## M08 — Stint Gantt strip

**When**: showing strategy across drivers — compound segments per
driver, stint lengths, pit windows. Compound color: hard=#E5E7EB,
medium=#FCD34D, soft=#EF4444, inter=#22C55E, wet=#3B82F6.

**Sample prompt** (qid 1943):
> Did Mercedes split strategies between Russell and Hamilton at Spa 2025?

```json
{
  "title": "Mercedes Strategy Split — Spa 2025",
  "subtitle": "2025 Belgian GP · Race",
  "body": "Mercedes split their two cars between a one-stop (Russell, M-H) and a two-stop (Hamilton, M-H-M). Russell's longer first stint preserved track position; Hamilton's two-stop yielded fresher rubber for the closing 12 laps and a fastest-lap point.",
  "metrics": [
    { "label": "Russell stops", "value": "1" },
    { "label": "Hamilton stops", "value": "2", "emphasis": true },
    { "label": "Net delta", "value": "+1.8s", "unit": "Russell ahead at flag" }
  ],
  "chart": {
    "type": "stint_gantt",
    "y_axis": ["Russell", "Hamilton"],
    "total_laps": 44,
    "stints": [
      { "driver": "Russell",  "start": 1,  "end": 22, "compound": "medium", "lap_times_avg": 109.4 },
      { "driver": "Russell",  "start": 23, "end": 44, "compound": "hard",   "lap_times_avg": 110.8 },
      { "driver": "Hamilton", "start": 1,  "end": 14, "compound": "medium", "lap_times_avg": 109.7 },
      { "driver": "Hamilton", "start": 15, "end": 32, "compound": "hard",   "lap_times_avg": 110.2 },
      { "driver": "Hamilton", "start": 33, "end": 44, "compound": "medium", "lap_times_avg": 109.1 }
    ],
    "compound_legend": {
      "hard":   "#E5E7EB",
      "medium": "#FCD34D",
      "soft":   "#EF4444",
      "inter":  "#22C55E",
      "wet":    "#3B82F6"
    }
  },
  "key_takeaways": [
    "Russell ran a one-stop M→H",
    "Hamilton ran a two-stop M→H→M",
    "Hamilton's closing-stint mediums 1.1s/lap quicker than Russell's hards",
    "Net result: Russell ahead by 1.8s at flag"
  ]
}
```

---

## M09 — Multi-line lap-time chart

**When**: lap-by-lap pace comparison, traffic recovery, fuel-corrected
delta. Lines colored by team palette. Optionally overlay a horizontal
"race fastest" marker.

**Sample prompt** (qid 1924):
> How did Hamilton's race pace compare to Russell across the first stint at Monza 2025?

```json
{
  "title": "First Stint Pace — Monza 2025",
  "subtitle": "2025 Italian GP · Race · laps 1-22",
  "body": "Hamilton (Ferrari) averaged 83.95s per lap with a best of 82.88s, marginally quicker than Russell (Mercedes) who averaged 84.31s with a best of 83.41s. Hamilton's pace advantage of ~0.36s/lap was steady across the 22-lap stint with no degradation gap.",
  "metrics": [
    { "label": "Hamilton avg", "value": "83.95", "unit": "s/lap" },
    { "label": "Russell avg",  "value": "84.31", "unit": "s/lap" },
    { "label": "Delta",        "value": "+0.36", "unit": "s/lap", "emphasis": true }
  ],
  "chart": {
    "type": "line",
    "x_label": "Lap",
    "y_label": "Lap time (s)",
    "series": [
      { "name": "Lewis Hamilton", "values": [83.5, 82.9, 83.1, 83.0, 83.4, 83.8, 84.0, 84.2, 84.3, 83.7, 83.9, 84.1, 84.0, 84.2, 84.4, 84.5, 84.3, 84.1, 84.0, 84.2, 84.4, 84.6], "color": "#DC0000" },
      { "name": "George Russell", "values": [84.0, 83.4, 83.6, 83.8, 84.0, 84.2, 84.3, 84.5, 84.6, 84.0, 84.2, 84.4, 84.3, 84.5, 84.7, 84.8, 84.6, 84.4, 84.3, 84.5, 84.7, 84.9], "color": "#27F4D2" }
    ],
    "horizontal_marker": { "value": 81.45, "label": "Race fastest (Verstappen)" }
  },
  "key_takeaways": [
    "Hamilton 0.36s/lap quicker on average",
    "Both on medium compound for the stint",
    "Hamilton's 82.88s was the stint's overall fastest",
    "No degradation divergence across 22 laps"
  ]
}
```

---

## M10 — Multi-line with stint-boundary markers (variant of M09)

**When**: lap-time line spanning multiple stints — needs vertical
stint-boundary markers to show pit timing.

**Sample prompt** (qid 2027):
> Across stints 1, 2 and 3 at Bahrain 2025, did Hamilton's middle-stint medium deltas to Leclerc reverse on the final hard stint?

```json
{
  "title": "Stint-by-Stint Deltas — Bahrain 2025",
  "subtitle": "2025 Bahrain GP · Race",
  "body": "Hamilton trailed Leclerc by ~0.4s/lap in stint 1 (mediums), reversed to a ~0.2s/lap advantage in stint 2 (also mediums but fresher), then trailed by ~0.6s/lap in stint 3 (hards) when Leclerc's tyre management paid off.",
  "chart": {
    "type": "line_with_stint_markers",
    "x_label": "Lap",
    "y_label": "Hamilton − Leclerc (s/lap)",
    "series": [
      { "name": "Hamilton − Leclerc delta", "values": [0.4, 0.4, 0.5, 0.4, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, -0.2, -0.2, -0.1, -0.2, -0.3, -0.2, -0.1, -0.2, -0.3, -0.4, 0.6, 0.6, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.0, 1.1, 1.0, 1.1, 1.2, 1.1, 1.0, 1.1, 1.0, 1.1, 1.2, 1.1, 1.0, 1.1, 1.0, 1.1, 1.2, 1.1, 1.0, 1.1, 1.0, 1.1, 1.0, 1.0, 1.0], "color": "#DC0000" }
    ],
    "stint_boundaries": [
      { "lap": 12, "label": "Pit → medium" },
      { "lap": 22, "label": "Pit → hard" }
    ],
    "horizontal_marker": { "value": 0, "label": "even" }
  },
  "key_takeaways": [
    "Stint 1 (medium): Hamilton −0.4s/lap",
    "Stint 2 (fresher medium): Hamilton +0.2s/lap",
    "Stint 3 (hard): Hamilton −0.6s/lap",
    "Final-stint reversal driven by Leclerc's hard-tyre management"
  ]
}
```

---

## M11 — Scatter + regression line

**When**: tyre degradation curve, brake-zone consistency, fuel-effect
slope. Y = lap time / metric, X = stint lap, points colored per
driver, regression line per series with slope label.

**Sample prompt** (qid 2024):
> Compare medium-compound deg curves between McLaren and Red Bull in stint 2 at Jeddah 2025 — was the gap aero-driven?

```json
{
  "title": "Medium Stint Degradation — Jeddah 2025",
  "subtitle": "2025 Saudi Arabian GP · Race · Stint 2",
  "body": "Norris ran a 0.142 s/lap deg slope across his 18-lap stint; Verstappen ran 0.118 s/lap across 19 laps. Red Bull's flatter curve favored long-stint pace by ~0.5s end-to-end.",
  "metrics": [
    { "label": "Norris slope",     "value": "0.142", "unit": "s/lap" },
    { "label": "Verstappen slope", "value": "0.118", "unit": "s/lap" },
    { "label": "Delta",            "value": "+0.024", "unit": "s/lap", "emphasis": true }
  ],
  "chart": {
    "type": "scatter_with_regression",
    "x_label": "Stint lap",
    "y_label": "Lap time (s)",
    "series": [
      { "name": "Lando Norris", "color": "#FF8000", "slope": 0.142,
        "points": [[1,91.2],[2,90.8],[3,90.9],[4,91.0],[5,91.1],[6,91.3],[7,91.4],[8,91.5],[9,91.6],[10,91.7],[11,91.8],[12,92.0],[13,92.1],[14,92.3],[15,92.4],[16,92.5],[17,92.7],[18,92.8]]
      },
      { "name": "Max Verstappen", "color": "#1E41FF", "slope": 0.118,
        "points": [[1,91.5],[2,91.0],[3,91.1],[4,91.2],[5,91.3],[6,91.4],[7,91.4],[8,91.5],[9,91.6],[10,91.7],[11,91.7],[12,91.8],[13,91.9],[14,92.0],[15,92.0],[16,92.1],[17,92.2],[18,92.3],[19,92.4]]
      }
    ]
  },
  "key_takeaways": [
    "Red Bull flatter deg by 0.024 s/lap",
    "End-to-stint gap ~0.5s in Verstappen's favor",
    "Both stints comparable length (18/19 laps)",
    "Suggests Red Bull tyre management, not aero-only"
  ]
}
```

---

## M12 — Lap-1 / restart diverging bar

**When**: positions gained/lost on launch or restart. Bars diverge
left/right from a 0 axis. Negative (positions lost) on left.

**Sample prompt** (qid 2103):
> On the lap-1 launch at Australia 2025, did Norris or Verstappen gain more positions before the first SC?

```json
{
  "title": "Lap-1 Launch — Australia 2025",
  "subtitle": "2025 Australian GP · Race · Lap 1",
  "body": "On the lap-1 launch at Albert Park, Sainz (Williams) gained the most (+4 from P14 to P10). Verstappen held P1; Norris dropped 1 position. Stroll was the biggest loser (−3).",
  "metrics": [
    { "label": "Best gainer",  "value": "+4", "unit": "Sainz", "emphasis": true },
    { "label": "Verstappen Δ", "value": "0", "unit": "held P1" },
    { "label": "Norris Δ",     "value": "−1" }
  ],
  "chart": {
    "type": "horizontal_bar_diverging",
    "y_axis": ["Sainz", "Antonelli", "Hülkenberg", "Albon", "Hadjar", "Verstappen", "Russell", "Hamilton", "Leclerc", "Norris", "Piastri", "Tsunoda", "Bortoleto", "Stroll"],
    "x_label": "Positions gained / lost (lap 1)",
    "series": [
      { "name": "Position Δ", "values": [4, 3, 3, 2, 1, 0, 0, 0, -1, -1, -1, -2, -2, -3], "colors": ["#1868DB","#27F4D2","#52E252","#1868DB","#6692FF","#1E41FF","#27F4D2","#DC0000","#DC0000","#FF8000","#FF8000","#6692FF","#52E252","#229971"] }
    ]
  },
  "key_takeaways": [
    "Sainz best of field at +4",
    "Verstappen converted pole cleanly",
    "Norris dropped 1 — wheelspin off the line",
    "Stroll lost 3 — squeezed at T1"
  ]
}
```

---

## M13 — Stacked horizontal bar (clean-air vs traffic)

**When**: laps split between two states (clean air / traffic, dry /
wet, qualifying / race). Lighter shade = positive, accent = negative.

**Sample prompt** (qid 2041):
> How many laps did Norris spend in clean air during his winning Mexico GP 2025 stint?

```json
{
  "title": "Clean-Air vs Traffic — Norris Mexico 2025",
  "subtitle": "2025 Mexico City GP · Race",
  "body": "Across 71 laps at Mexico, Norris spent 58 laps in clean air (82%) and 13 in traffic (largely the early laps before clearing the Ferraris on lap 12). His clean-air pace was 0.42 s/lap quicker than his in-traffic pace.",
  "metrics": [
    { "label": "Clean-air laps",  "value": "58", "emphasis": true },
    { "label": "Traffic laps",    "value": "13" },
    { "label": "Pace delta",      "value": "+0.42", "unit": "s/lap" }
  ],
  "chart": {
    "type": "stacked_horizontal_bar",
    "y_axis": ["Norris"],
    "x_label": "Laps",
    "series": [
      { "name": "Clean Air", "values": [58], "color": "#A3A3A3" },
      { "name": "In Traffic", "values": [13], "color": "#E10600" }
    ]
  },
  "key_takeaways": [
    "82% of laps in clean air",
    "Traffic concentrated in opening 12 laps",
    "Pace penalty in traffic: +0.42 s/lap",
    "Lap 12 onward: race pace untouched by traffic"
  ]
}
```

---

## M14 — Dual-axis line chart (lap time × weather)

**When**: weather impact, tyre warmup. Primary Y = lap time;
secondary Y = rainfall mm/hr or track temp °C. Vertical markers at
crossover laps.

**Sample prompt** (qid 2123):
> What was the inter-to-slick crossover lap for the McLarens at Australia 2025?

```json
{
  "title": "Inter-to-Slick Crossover — Australia 2025",
  "subtitle": "2025 Australian GP · Race",
  "body": "Both McLaren drivers made the inters-to-slicks crossover on lap 22 (Norris) and lap 23 (Piastri) when track temp passed 28°C and the dry line developed. Their decision was 2 laps later than the leaders — a calculated bet that paid off when both moved up positions.",
  "metrics": [
    { "label": "Norris crossover",  "value": "Lap 22", "emphasis": true },
    { "label": "Piastri crossover", "value": "Lap 23" },
    { "label": "Wet-pace delta",    "value": "+8.2",   "unit": "s/lap" }
  ],
  "chart": {
    "type": "line_dual_axis",
    "x_label": "Lap",
    "y1_label": "Lap time (s)",
    "y2_label": "Rainfall (mm/hr)",
    "series": [
      { "name": "Norris (lap time)",  "axis": "y1", "color": "#FF8000",
        "values": [98,95,92,90,89,87,86,85,85,86,87,88,89,90,91,92,93,92,91,90,89,88,84,83,83,83,83,83] },
      { "name": "Piastri (lap time)", "axis": "y1", "color": "#FFB266",
        "values": [99,96,93,91,90,88,87,86,86,87,88,89,90,91,92,93,94,93,92,91,90,89,88,84,83,83,83,83] },
      { "name": "Rainfall",            "axis": "y2", "color": "#1868DB",
        "values": [3,4,4,5,5,4,3,2,2,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] }
    ],
    "vertical_markers": [
      { "x": 22, "label": "Norris pits → med" },
      { "x": 23, "label": "Piastri pits → med" }
    ]
  },
  "key_takeaways": [
    "Both McLarens crossed over within 1 lap of each other",
    "Track temp passed 28°C around lap 21",
    "2 laps later than leader",
    "Wet-pace gap was +8.2 s/lap vs dry race pace"
  ]
}
```

---

## M15 — Event timeline (steward decisions)

**When**: list of discrete time-stamped events with kind/severity tags.
Layout: vertical list of cards, lap number prominent on left, kind
tag (color-coded), driver, message excerpt.

**Sample prompt** (qid 2140):
> How many penalty points were issued by stewards at the 2025 São Paulo Grand Prix?

```json
{
  "title": "Steward Decisions — São Paulo 2025",
  "subtitle": "2025 São Paulo GP · Race",
  "body": "Stewards issued 4 penalty points across the race, plus three 5-second time penalties without points. Largest single hit: Stroll (2 points, forcing-off). No drive-throughs.",
  "metrics": [
    { "label": "Penalty points",  "value": "4", "emphasis": true },
    { "label": "5-sec penalties", "value": "3" },
    { "label": "Drive-throughs",  "value": "0" }
  ],
  "chart": {
    "type": "event_timeline",
    "events": [
      { "lap": 6,  "driver": "Piastri",   "kind": "racing_incident",  "kind_color": "#9CA3AF", "team_color": "#FF8000", "severity": "no_action", "message": "Lap 6 Turn 1 — Piastri/Antonelli/Leclerc contact: NO INVESTIGATION" },
      { "lap": 12, "driver": "Sainz",     "kind": "track_limits",     "kind_color": "#F59E0B", "team_color": "#1868DB", "severity": "5_sec",     "message": "5 SEC PEN — TRACK LIMITS T7" },
      { "lap": 28, "driver": "Stroll",    "kind": "forcing_off",      "kind_color": "#EF4444", "team_color": "#229971", "severity": "5_sec_2pt", "message": "5 SEC PEN + 2 POINTS — FORCING ANOTHER DRIVER OFF" },
      { "lap": 41, "driver": "Hülkenberg","kind": "track_limits",     "kind_color": "#F59E0B", "team_color": "#52E252", "severity": "5_sec",     "message": "5 SEC PEN — TRACK LIMITS T4" },
      { "lap": 47, "driver": "Tsunoda",   "kind": "unsafe_release",   "kind_color": "#EF4444", "team_color": "#6692FF", "severity": "5_sec_2pt", "message": "5 SEC PEN + 2 POINTS — UNSAFE PIT RELEASE" }
    ]
  },
  "key_takeaways": [
    "4 total penalty points (2 to Stroll, 2 to Tsunoda)",
    "Track limits accounted for 50% of 5-sec penalties",
    "No drive-through or stop/go",
    "Lap-6 contact ruled racing incident (no action)"
  ]
}
```

---

## M16 — Track-shape minisector heatmap

**When**: minisector dominance / sector deep-dives. Render a
simplified circuit outline (SVG) and color each minisector segment
by which driver dominated. Fallback: a vertical strip (segments
stacked top-to-bottom).

**Sample prompt** (qid 1706):
> Which corners did Verstappen gain on Norris through Sector 2 at Silverstone 2025 — Maggotts, Becketts, or Chapel?

```json
{
  "title": "Sector 2 Minisector Dominance — Silverstone 2025",
  "subtitle": "2025 British GP · Qualifying · Sector 2",
  "body": "Verstappen led 14 of 22 Sector 2 minisectors. Strongest gains: Maggotts (T10), Becketts (T11), Chapel (T12). Norris reclaimed Stowe complex (T15-16).",
  "metrics": [
    { "label": "Verstappen", "value": "14", "unit": "minisectors", "emphasis": true },
    { "label": "Norris",     "value": "8",  "unit": "minisectors" },
    { "label": "Total S2",   "value": "22" }
  ],
  "chart": {
    "type": "track_heatmap",
    "circuit": "Silverstone",
    "sector": 2,
    "view": "track_shape",
    "segments": [
      { "minisector_index": 23, "name": "T9 Copse",      "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 12 },
      { "minisector_index": 24, "name": "T9 Copse exit", "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 8 },
      { "minisector_index": 25, "name": "T10 Maggotts",  "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 22 },
      { "minisector_index": 26, "name": "T10 Maggotts",  "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 18 },
      { "minisector_index": 27, "name": "T11 Becketts",  "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 28 },
      { "minisector_index": 28, "name": "T11 Becketts",  "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 25 },
      { "minisector_index": 29, "name": "T12 Chapel",    "leader": "Verstappen", "color": "#1E41FF", "delta_ms": 16 },
      { "minisector_index": 30, "name": "T13 Hangar",    "leader": "Norris",     "color": "#FF8000", "delta_ms": 6 },
      { "minisector_index": 31, "name": "T15 Stowe",     "leader": "Norris",     "color": "#FF8000", "delta_ms": 14 },
      { "minisector_index": 32, "name": "T16 Stowe",     "leader": "Norris",     "color": "#FF8000", "delta_ms": 11 }
    ]
  },
  "key_takeaways": [
    "Verstappen +6 net minisectors",
    "Verstappen dominated high-speed esses",
    "Norris reclaimed Stowe complex (T15-16)",
    "Sector 2 net delta: Verstappen +0.18s"
  ]
}
```

---

## M17 — Radar (7-axis driver score)

**When**: Phase 21 driver-performance composite score across 7 axes.
1-2 polygons overlaid, team-color-filled with low alpha.

**Sample prompt** (qid 2162):
> Where does Verstappen's edge over Norris come from in 2025 — qualifying axis or race-pace axis?

```json
{
  "title": "7-Axis Performance — Verstappen vs Norris 2025",
  "subtitle": "2025 Season · Aggregate (rounds 1-15)",
  "body": "Verstappen leads in qualifying (+6), tyre management (+5), error-rate (+7). Norris leads on overtake-difficulty (+14, recovery-drive bias). Race-pace and traffic-handling roughly even.",
  "chart": {
    "type": "radar",
    "axes": ["qualifying", "race_pace", "tyre_management", "restart", "traffic_handling", "overtake_difficulty", "error_rate"],
    "max_value": 100,
    "series": [
      { "name": "Max Verstappen", "values": [88, 90, 76, 75, 80, 64, 95], "color": "#1E41FF" },
      { "name": "Lando Norris",   "values": [82, 88, 71, 100, 78, 78, 88], "color": "#FF8000" }
    ]
  },
  "key_takeaways": [
    "Verstappen leads on qualifying (+6), tyre mgmt (+5), error-rate (+7)",
    "Norris leads on overtake-difficulty (+14, recovery bias)",
    "Restart axis: Norris 100 vs Verstappen 75",
    "Both top-tier on race-pace (90 / 88)"
  ]
}
```

---

## M18 — Status grid (data health)

**When**: data-completeness questions. Rows = sessions or drivers;
columns = data sources (laps / car_data / location / weather / pit);
cells colored full (green) / partial (yellow) / missing (red).

**Sample prompt** (qid 2186):
> Across the 2025 season, which sessions have telemetry but no matching weather data?

```json
{
  "title": "Telemetry-Weather Coverage Gap — 2025",
  "subtitle": "All sessions · 2025",
  "body": "8 sessions show full car-data coverage but missing or partial weather. Concentrates at Lusail (Qatar) and Mexico City. The reverse gap (weather but no telemetry) appears in 3 early-season practice sessions.",
  "metrics": [
    { "label": "Telemetry-only gap", "value": "8", "unit": "sessions" },
    { "label": "Weather-only gap",   "value": "3", "unit": "sessions" },
    { "label": "Full coverage",      "value": "109", "unit": "sessions" }
  ],
  "chart": {
    "type": "status_grid",
    "columns": ["laps", "car_data", "location", "weather", "pit"],
    "rows": [
      { "session_key": 9836, "label": "Lusail Qualifying", "cells": { "laps": "full", "car_data": "full", "location": "full", "weather": "missing", "pit": "full" } },
      { "session_key": 9839, "label": "Lusail Sprint",     "cells": { "laps": "full", "car_data": "full", "location": "full", "weather": "missing", "pit": "full" } },
      { "session_key": 9850, "label": "Lusail Race",       "cells": { "laps": "full", "car_data": "full", "location": "full", "weather": "missing", "pit": "full" } },
      { "session_key": 9877, "label": "Mexico Race",       "cells": { "laps": "full", "car_data": "full", "location": "full", "weather": "partial", "pit": "full" } },
      { "session_key": 9873, "label": "Mexico Qualifying", "cells": { "laps": "full", "car_data": "full", "location": "full", "weather": "partial", "pit": "full" } }
    ],
    "legend": { "full": "#22C55E", "partial": "#F59E0B", "missing": "#EF4444" }
  },
  "key_takeaways": [
    "Lusail (Qatar) entirely missing weather rows — 3 sessions",
    "Mexico City has partial weather (lap-by-lap incomplete)",
    "3 early-season practice sessions: weather present, telemetry paused",
    "Full coverage on 109 of 120 sessions (90.8%)"
  ]
}
```

---

## M19 — Donut / stacked share

**When**: percentage breakdowns — DRS-aided overtakes, dry vs wet
session share, compound mix. Single donut with 2-4 slices, total
in center.

**Sample prompt** (qid 2085):
> At Singapore 2025, compare the percentage of overtakes completed inside the new fourth DRS zone vs the original three.

```json
{
  "title": "DRS Zone Share — Singapore 2025",
  "subtitle": "2025 Singapore GP · Race",
  "body": "Of 47 on-track overtakes at Singapore 2025, the new fourth DRS zone (start-finish straight) accounted for 32 (68%). The original three zones (T2-3, T7, T14) accounted for 15 combined.",
  "metrics": [
    { "label": "Total overtakes", "value": "47" },
    { "label": "Zone 4 share",    "value": "68%", "emphasis": true },
    { "label": "Zones 1-3 share", "value": "32%" }
  ],
  "chart": {
    "type": "donut",
    "center_label": "47\novertakes",
    "slices": [
      { "label": "Zone 4 (new)",    "value": 32, "color": "#E10600" },
      { "label": "Zone 1 (T2-3)",   "value": 8,  "color": "#1E41FF" },
      { "label": "Zone 2 (T7)",     "value": 4,  "color": "#FF8000" },
      { "label": "Zone 3 (T14)",    "value": 3,  "color": "#27F4D2" }
    ]
  },
  "key_takeaways": [
    "New zone 4 accounted for 68% of overtakes",
    "Original three zones combined: 32%",
    "Zone 4 was the longest DRS-active stretch on the lap",
    "Highest Singapore overtake count in 5 seasons"
  ]
}
```

---

## M20 — Multi-shape composite (cross_category)

**When**: cross_category questions stack 2-3 shapes ("did A also
coincide with B and C?"). Layout: a wrapper card with up to 3
sub-cards stacked vertically, each is a smaller version of the
shapes above.

**Sample prompt** (qid 2200):
> At Imola 2025, did the front-right graining that forced Piastri into an early stop also coincide with a pace cliff in the laps before the stop?

```json
{
  "title": "Imola — Piastri Front-Right Graining",
  "subtitle": "2025 Emilia-Romagna GP · Race · stint 1",
  "body": "YES — Piastri's lap-pace fell off a cliff over laps 14-16 before his lap-17 stop, with deltas of +0.4, +0.7, +1.1 s/lap to his stint-best. The cliff coincided with the team's radio call about front-right graining.",
  "verdict": { "label": "YES", "color": "#E10600", "summary": "Pace cliff lap 14-16, stop lap 17" },
  "composite": [
    {
      "type": "line",
      "title": "Pace cliff (laps 1-17)",
      "x_label": "Lap",
      "y_label": "Δ to stint-best (s)",
      "series": [
        { "name": "Piastri", "color": "#FF8000", "values": [0.0, 0.05, 0.08, 0.1, 0.12, 0.15, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.3, 0.4, 0.7, 1.1, 1.4] }
      ],
      "vertical_markers": [{ "x": 17, "label": "Pit" }]
    },
    {
      "type": "metric_grid_3",
      "title": "Cliff metrics",
      "metrics": [
        { "label": "Cliff onset", "value": "Lap 14" },
        { "label": "Δ at lap 16", "value": "+1.1 s/lap", "emphasis": true },
        { "label": "Stop lap",    "value": "17" }
      ]
    }
  ],
  "key_takeaways": [
    "Cliff began lap 14, accelerated lap 16",
    "+1.1 s/lap on the final pre-stop lap",
    "Stop on lap 17 was reactive, not strategic",
    "Front-right radio call confirmed by lap-pace pattern"
  ]
}
```

---

## M21 — No-data refusal card

**When**: question asks for data the project does not ingest (brake
temps, fuel burn, slip angles, ERS deployment, differential settings,
front-wing damage state, raw steering angle traces).

**Layout**: muted card (no red dot — gray instead), title prefixed
"Not in dataset", explanation of which data category isn't ingested,
suggestion of what we DO have.

**Sample prompt** (qid 1750):
> What was the brake temperature on Hamilton's car at Turn 8 in Monza 2025?

```json
{
  "title": "Not in dataset — Brake temperatures",
  "subtitle": "Hamilton · Monza 2025 · Turn 8",
  "tone": "muted",
  "body": "Brake temperatures aren't part of the OpenF1 public telemetry feed. We ingest car_data (speed, throttle, brake on/off, n_gear, RPM, DRS), location, lap times, weather, and race control — but not internal component telemetry like brake/tyre temps, fuel flow, or ERS state-of-charge.",
  "what_we_have": [
    "Speed at any sample point on the lap",
    "Brake-pedal on/off state and pressure proxy",
    "Throttle application percentage",
    "Lap-time deltas through the brake zone"
  ],
  "related_questions": [
    "What was Hamilton's speed entering Turn 8?",
    "Compare brake-zone deceleration at Turn 8",
    "Show throttle-application timing out of Turn 8"
  ]
}
```

---

## M22 — Pit-cycle event card (sub-variant of M02)

**When**: single-decision pit question. Shows the event sequence
visually: in-lap → pit-loss → out-lap → cycle outcome.

**Sample prompt** (qid 2061):
> What was Verstappen's first-stop lap number in the 2025 Canadian Grand Prix?

```json
{
  "title": "Verstappen First Stop — Canada 2025",
  "subtitle": "2025 Canadian GP · Race",
  "body": "Verstappen made his first stop on lap 28 of 70, switching from medium to hard. The stop lasted 2.4s stationary; total pit-loss was 21.8s. He emerged in P3 and recovered to P1 by lap 42.",
  "metrics": [
    { "label": "Stop lap",      "value": "28", "emphasis": true },
    { "label": "Stationary",    "value": "2.4", "unit": "sec" },
    { "label": "Total pit loss","value": "21.8", "unit": "sec" }
  ],
  "chart": {
    "type": "pit_event_strip",
    "phases": [
      { "label": "In-lap (27)",     "duration_sec": 78.2, "color": "#9CA3AF" },
      { "label": "Pit lane",        "duration_sec": 21.8, "color": "#E10600" },
      { "label": "Out-lap (29)",    "duration_sec": 79.4, "color": "#9CA3AF" }
    ],
    "post_cycle": {
      "before_position": 1,
      "after_position": 3,
      "recovered_by_lap": 42
    }
  },
  "key_takeaways": [
    "Stop lap 28 of 70 (40% race distance)",
    "Stationary time 2.4s — clean stop",
    "Cycle dropped him from P1 → P3",
    "Recovered to P1 by lap 42"
  ]
}
```

---

## M23 — Overtake-location track map (sub-variant of M16)

**When**: question asks WHERE on the circuit overtakes happened.
Render the track outline with markers at each overtake location;
marker color = overtaker's team.

**Sample prompt** (qid 2081):
> Where on the Imola circuit did Norris overtake Piastri in the closing laps of the 2025 Emilia-Romagna GP?

```json
{
  "title": "Norris → Piastri Pass — Imola 2025",
  "subtitle": "2025 Emilia-Romagna GP · Race · Lap 58",
  "body": "Norris made the pass at Tamburello (Turn 2) on lap 58, using DRS into the braking zone. Entry-speed delta was +6 km/h; tyre age delta was 12 laps fresher.",
  "metrics": [
    { "label": "Location",   "value": "Tamburello", "emphasis": true },
    { "label": "Lap",        "value": "58 of 63" },
    { "label": "Tyre delta", "value": "12 laps fresher" }
  ],
  "chart": {
    "type": "track_marker_map",
    "circuit": "Imola",
    "markers": [
      { "lap": 58, "corner": "T2 Tamburello", "x_track_pct": 0.08, "y_track_pct": 0.62, "label": "Norris pass", "color": "#FF8000" }
    ]
  },
  "key_takeaways": [
    "Pass executed at Tamburello (T2) on lap 58",
    "DRS-aided into the braking zone",
    "Entry-speed delta +6 km/h",
    "Norris was 12 laps fresher on tyres"
  ]
}
```

---

## Implementation order for v0

**Tier 1 — high-frequency (build first, ~70% of questions)**:
M01 hero, M02 yes/no, M03 3-tile, M06 ranking bar, M08 stint Gantt,
M09 multi-line, M21 no-data refusal.

**Tier 2 — medium-frequency (~20% of questions)**:
M04 already built · M05 braking variant, M11 scatter+regression,
M12 diverging bar, M13 stacked, M14 dual-axis, M15 timeline,
M18 status grid.

**Tier 3 — specialized (10%, harder to render)**:
M16 minisector heatmap (needs SVG circuit outlines per venue),
M17 radar, M19 donut, M20 cross-cat composite, M22 pit-cycle strip,
M23 track marker map.

**Each mock as a fixture file**: drop into
`web/src/__mocks__/insights/{mocknum}-{slug}.ts` exporting an
`InsightMock` typed object so the renderer surface-tests against
real shapes. Build a `/mock` route in the Next.js app that imports
all 23 fixtures and renders them in a scrolling grid for design
review.

---

## Quick lookup — qid to mock-id

(Use this to find a real benchmark question for any mock you're
testing.)

| Mock | Sample qid | Other qids that fit |
|---|---|---|
| M01 hero | 1922 | 1920, 1940, 1941, 2000, 2060, 2080, 2120, 2160, 2180 |
| M02 yes/no | 2062 | 1903, 1943, 1945, 1947, 2004, 2065, 2086, 2120, 2200-2208 |
| M03 3-tile | 1960 | 1710, 1714, 1750-1758 (refusal variant), 1980, 2061 |
| M04 corner grouped bar | 1717 | 1713, 1715, 1718, 1719, 1968 |
| M05 braking grouped bar | 1969 | 1962, 1963, 1964, 1967, 1981, 1985, 1987 |
| M06 ranking bar | 2080 | 1701, 1712, 2001, 2002, 2080, 2101, 2160 |
| M07 team-grouped ranking | 2000 | 2003, 2006, 2007, 2009 |
| M08 stint Gantt | 1943 | 1940, 1944, 1948, 1949, 2026 |
| M09 multi-line pace | 1924 | 1925, 1926, 1928, 1929, 2042, 2043, 2044 |
| M10 line w/ stint markers | 2027 | 1947, 1948, 2025, 2029 |
| M11 scatter+regression | 2024 | 2020, 2022, 2024, 2028, 2029 |
| M12 diverging bar | 2103 | 2100, 2101, 2102, 2104, 2105 |
| M13 stacked horizontal | 2041 | 2040, 2044, 2045, 2046, 2047 |
| M14 dual-axis line | 2123 | 2121, 2122, 2124, 2125, 2126 |
| M15 event timeline | 2140 | 2141, 2142, 2143, 2144, 2145, 2146 |
| M16 minisector heatmap | 1706 | 1700, 1702, 1703, 1707, 1708, 1710, 1711 |
| M17 radar | 2162 | 2160, 2161, 2163, 2164, 2165, 2166, 2167 |
| M18 status grid | 2186 | 2181, 2182, 2183, 2184, 2185, 2187 |
| M19 donut | 2085 | 2083, 2120 (dry/wet share) |
| M20 cross-cat composite | 2200 | 2201, 2202, 2203, 2204, 2205, 2206, 2207, 2208 |
| M21 no-data refusal | 1750 | 1751, 1752, 1753, 1754, 1755, 1756, 1757, 1758 |
| M22 pit-cycle event | 2061 | 2062, 2063, 2067 |
| M23 track marker map | 2081 | 2082, 2084 |

---

**File**: `diagnostic/phase26_v0_visualization_brief_2026-05-05.md`
**Companion**: `diagnostic/phase26_analysis_categories_plan_2026-05-05.md`
(the data-category view; this brief is the visualization-shape view).
