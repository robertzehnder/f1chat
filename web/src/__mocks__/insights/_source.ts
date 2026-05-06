import type { InsightMock } from "@/lib/chart-types"

// Category 1 — Corner Analysis
export const cornerAnalysisMock: InsightMock = {
  title: "Suzuka Esses Comparison",
  subtitle: "2025 Japanese GP - Race",
  body: "Across the Suzuka esses (Turns 7-9) at the 2025 Japanese GP, Verstappen (Red Bull) carried consistently higher entry and apex speeds at Turns 7 and 8, while Hamilton (Ferrari) was marginally quicker through Turn 9. At Turn 7, Verstappen averaged 232.6 km/h entry vs Hamilton's 227.3 km/h — a ~5 km/h entry advantage. At Turn 8 (Degner 1), Verstappen again led with 247.6 km/h entry vs 241.8 km/h. Turn 9 (Degner 2) flipped slightly in Hamilton's favour.",
  chart: {
    type: "grouped_bar",
    x_axis: ["T7", "T8", "T9"],
    y_label: "Entry speed (km/h)",
    series: [
      { name: "Max Verstappen", values: [233, 248, 264], color: "#3671C6" },
      { name: "Lewis Hamilton", values: [227, 242, 263], color: "#E80020" }
    ]
  },
  key_takeaways: [
    "Verstappen +5 km/h on average entry speed at Turns 7 & 8",
    "Hamilton stronger on exit at Turn 9 (Degner 2)",
    "53 laps analyzed for statistical confidence",
    "Red Bull's downforce setup favors high-speed entry"
  ],
  related_questions: [
    "Show qualifying comparison",
    "Add Leclerc to comparison",
    "Analyze hairpin (Turn 11)"
  ]
}

// Category 2 — Lap Pace & Fastest Lap
export const lapPaceMock: InsightMock = {
  title: "First Stint Pace — Monza 2025",
  subtitle: "2025 Italian GP - Race",
  body: "Across his first stint at Monza 2025 (laps 1-22 on the medium compound), Hamilton (Ferrari) averaged 83.95s per lap with a best of 82.88s, marginally quicker than Russell (Mercedes) who averaged 84.31s with a best of 83.41s. Hamilton's pace advantage of ~0.36s/lap reflects Ferrari's straight-line speed at Monza.",
  metrics: [
    { label: "Hamilton Avg", value: "83.95", unit: "sec/lap" },
    { label: "Russell Avg", value: "84.31", unit: "sec/lap" },
    { label: "Delta", value: "+0.36", unit: "sec/lap", emphasis: true }
  ],
  chart: {
    type: "line",
    x_label: "Lap",
    y_label: "Lap time (s)",
    series: [
      { name: "Lewis Hamilton", values: [83.5, 82.9, 83.1, 83.0, 83.4, 83.8, 84.0, 84.2, 84.3, 83.7, 83.9, 84.1, 84.0, 84.2, 84.4, 84.5, 84.3, 84.1, 84.0, 84.2, 84.4, 84.6], color: "#E80020" },
      { name: "George Russell", values: [84.0, 83.4, 83.6, 83.8, 84.0, 84.2, 84.3, 84.5, 84.6, 84.0, 84.2, 84.4, 84.3, 84.5, 84.7, 84.8, 84.6, 84.4, 84.3, 84.5, 84.7, 84.9], color: "#27F4D2" }
    ]
  },
  key_takeaways: [
    "Hamilton averaged 83.95s vs Russell 84.31s — 0.36s/lap quicker",
    "Both on the medium compound for the first stint",
    "Hamilton's best lap of 82.88s was the stint's overall fastest",
    "Pace delta consistent across the 22-lap stint"
  ],
  related_questions: [
    "Show fuel-corrected pace",
    "Compare second-stint pace",
    "Add Leclerc and Antonelli"
  ]
}

// Category 3 — Tyre Strategy
export const tyreStrategyMock: InsightMock = {
  title: "Medium-Compound Stint 2 Degradation",
  subtitle: "2025 Saudi Arabian GP - Race",
  body: "In their second stint on the medium compound at Jeddah 2025, McLaren ran a slightly more aggressive deg profile than Red Bull. Norris (McLaren) averaged 0.142 s/lap of degradation across his 18-lap stint; Verstappen (Red Bull) showed 0.118 s/lap across 19 laps. The 0.024 s/lap gap (~0.5s over the stint) is consistent with Red Bull's more conservative tyre management at high-fuel conditions.",
  metrics: [
    { label: "Norris Deg", value: "0.142", unit: "s/lap" },
    { label: "Verstappen Deg", value: "0.118", unit: "s/lap" },
    { label: "Delta", value: "+0.024", unit: "s/lap", emphasis: true }
  ],
  chart: {
    type: "scatter_with_regression",
    x_label: "Stint lap",
    y_label: "Lap time (s)",
    series: [
      { name: "Lando Norris", points: [[1, 91.2], [2, 90.8], [3, 90.9], [4, 91.0], [5, 91.1], [6, 91.3], [7, 91.4], [8, 91.5], [9, 91.6], [10, 91.7], [11, 91.8], [12, 92.0], [13, 92.1], [14, 92.3], [15, 92.4], [16, 92.5], [17, 92.7], [18, 92.8]], color: "#FF8000", slope: 0.142, values: [] },
      { name: "Max Verstappen", points: [[1, 91.5], [2, 91.0], [3, 91.1], [4, 91.2], [5, 91.3], [6, 91.4], [7, 91.4], [8, 91.5], [9, 91.6], [10, 91.7], [11, 91.7], [12, 91.8], [13, 91.9], [14, 92.0], [15, 92.0], [16, 92.1], [17, 92.2], [18, 92.3]], color: "#3671C6", slope: 0.118, values: [] }
    ]
  },
  key_takeaways: [
    "McLaren's medium-compound deg ~0.024 s/lap higher than Red Bull",
    "Both teams ran 18-19 lap stints — comparable workload",
    "Red Bull's flatter curve suggests cooler tyre management",
    "Stint-end pace gap of ~0.5s favors Red Bull's strategy"
  ],
  related_questions: [
    "Show fuel-corrected pace",
    "Compare hard-compound stints",
    "Add Ferrari to comparison"
  ]
}

// Category 4 — Pit Strategy
export const pitStrategyMock: InsightMock = {
  title: "Pit Loss — Spa-Francorchamps 2025",
  subtitle: "2025 Belgian GP - Race",
  body: "At the 2025 Belgian GP, the average pit-loss across all stops was 22.4 seconds. Verstappen's stops were the cleanest (avg 21.2s), Hamilton's were slightly costlier (avg 23.1s) due to a slow rear-left changeover on his second stop. The fastest single stop was Norris's first at 20.9s; the slowest was Stroll's at 26.3s after a wheelnut hesitation.",
  metrics: [
    { label: "Avg Pit Loss", value: "22.4", unit: "sec" },
    { label: "Fastest Stop", value: "20.9", unit: "sec", emphasis: true },
    { label: "Slowest Stop", value: "26.3", unit: "sec" }
  ],
  chart: {
    type: "horizontal_bar",
    y_axis: ["Verstappen", "Norris", "Leclerc", "Russell", "Piastri", "Hamilton", "Sainz", "Alonso", "Stroll"],
    x_label: "Pit loss (s)",
    series: [
      { name: "Pit Loss", values: [21.2, 21.5, 21.8, 22.1, 22.4, 23.1, 23.4, 24.0, 26.3], color: "" }
    ]
  },
  key_takeaways: [
    "Average pit loss at Spa: 22.4s",
    "Verstappen's stops were the cleanest (21.2s avg)",
    "Stroll's slowest stop cost 5.4s vs the field average",
    "Two stops on a high-deg compound is the optimal strategy"
  ],
  related_questions: [
    "Compare to Hungary 2025 pit loss",
    "Show undercut success rate",
    "Pit stops under safety car"
  ]
}

// Category 5 — Restart & Lap-1 Performance
export const restartMock: InsightMock = {
  title: "Lap-1 Launch — Bahrain 2025",
  subtitle: "2025 Bahrain GP - Race",
  body: "On the lap-1 launch at the 2025 Bahrain GP, Sainz (Williams) gained the most positions, advancing 4 places from P14 on the grid to P10 by the end of lap 1. Antonelli (Mercedes) and Hülkenberg (Sauber) each gained 3. The biggest losers were Stroll (lost 3 positions, P9 → P12) and Bortoleto (lost 2).",
  metrics: [
    { label: "Biggest Gainer", value: "+4", unit: "Sainz", emphasis: true },
    { label: "Biggest Loser", value: "-3", unit: "Stroll" },
    { label: "Avg Movement", value: "1.8", unit: "positions" }
  ],
  chart: {
    type: "horizontal_bar_diverging",
    y_axis: ["Sainz", "Antonelli", "Hülkenberg", "Hadjar", "Albon", "Verstappen", "Norris", "Hamilton", "Russell", "Leclerc", "Piastri", "Tsunoda", "Bortoleto", "Stroll"],
    x_label: "Positions gained (lap 1)",
    series: [
      { name: "Position Δ", values: [4, 3, 3, 2, 1, 0, 0, 0, 0, -1, -1, -1, -2, -3], color: "" }
    ]
  },
  key_takeaways: [
    "Sainz gained 4 positions — best of the field",
    "Mercedes drivers split: Antonelli +3, Russell flat",
    "Stroll lost the most (-3), dropping from P9 to P12",
    "Front row converted cleanly: Verstappen and Norris held"
  ],
  related_questions: [
    "Show lap-2 settling pattern",
    "Compare to lap-1 at Australia 2025",
    "What about SC restart on lap 35?"
  ]
}

// Category 6 — Overtaking
export const overtakingMock: InsightMock = {
  title: "On-Track Overtakes — Singapore 2025",
  subtitle: "2025 Singapore GP - Race",
  body: "The 2025 Singapore GP saw 47 on-track overtakes across 62 laps — significantly higher than recent Singapore races thanks to the new fourth DRS zone added for 2025. Norris led with 8 overtakes (recovering from a Q3 mistake), followed by Hamilton with 6 and Hülkenberg with 5. The bulk of overtakes (32 of 47) happened in the first DRS zone on the start-finish straight.",
  metrics: [
    { label: "Total Overtakes", value: "47" },
    { label: "Most by Driver", value: "8", unit: "Norris", emphasis: true },
    { label: "DRS-Aided", value: "68%" }
  ],
  chart: {
    type: "horizontal_bar",
    y_axis: ["Norris", "Hamilton", "Hülkenberg", "Sainz", "Antonelli", "Albon", "Russell", "Hadjar", "Stroll", "Bortoleto"],
    x_label: "Overtakes",
    series: [
      { name: "Overtakes", values: [8, 6, 5, 4, 4, 3, 3, 2, 2, 1], color: "" }
    ]
  },
  key_takeaways: [
    "47 total overtakes — 2025's best Singapore figure",
    "Norris led recovery drive with 8 passes from P15 grid",
    "68% of overtakes were DRS-aided",
    "Fourth DRS zone accounted for most of the pickup"
  ],
  related_questions: [
    "Where did the overtakes happen?",
    "Compare DRS zones 1-3 vs zone 4",
    "Show Norris's lap-by-lap recovery"
  ]
}

// Category 9 — Stewards & Incidents  
export const incidentsMock: InsightMock = {
  title: "5-Second Time Penalties — Monza 2025",
  subtitle: "2025 Italian GP - Race",
  body: "The 2025 Italian GP saw 4 five-second time penalties: Sainz (track limits, lap 12), Stroll (forcing-off, lap 28), Hülkenberg (track limits, lap 41), and Tsunoda (unsafe release, lap 47). The unsafe release for Tsunoda was the only stop-go-equivalent ruling; the other three were standard track-limits / racing-incident penalties.",
  metrics: [
    { label: "Total 5-sec Penalties", value: "4" },
    { label: "Unique Drivers", value: "4" },
    { label: "Race Laps", value: "53" }
  ],
  chart: {
    type: "timeline",
    events: [
      { lap: 12, driver: "Sainz", kind: "track_limits", team_color: "#64C4FF", message: "5 SECOND TIME PENALTY — TRACK LIMITS" },
      { lap: 28, driver: "Stroll", kind: "forcing_off", team_color: "#229971", message: "5 SECOND TIME PENALTY — FORCING ANOTHER DRIVER OFF" },
      { lap: 41, driver: "Hülkenberg", kind: "track_limits", team_color: "#52E252", message: "5 SECOND TIME PENALTY — TRACK LIMITS" },
      { lap: 47, driver: "Tsunoda", kind: "unsafe_release", team_color: "#6692FF", message: "5 SECOND TIME PENALTY — UNSAFE RELEASE" }
    ]
  },
  key_takeaways: [
    "4 five-second penalties across 53 race laps",
    "Track limits accounted for 50% (2 of 4)",
    "Tsunoda's unsafe-release was the only pit-related penalty",
    "All 4 drivers stayed inside the points window"
  ],
  related_questions: [
    "Show drive-through penalties",
    "Stewards decisions by lap",
    "Compare to Monza 2024 incidents"
  ]
}

// Category 11 — Straight-line Speed
export const straightLineSpeedMock: InsightMock = {
  title: "Speed Trap — Monza 2025 Qualifying",
  subtitle: "2025 Italian GP - Qualifying",
  body: "Through the Monza 2025 qualifying speed trap, Verstappen recorded a top speed of 358.4 km/h on his Q3 lap, the field's third-fastest. Sainz (Williams) led the trap at 362.1 km/h thanks to Williams's low-drag Monza package; Antonelli (Mercedes) was second at 360.7. Verstappen's combination of cornering and straight-line speed was nonetheless the quickest overall, securing pole.",
  metrics: [
    { label: "Verstappen ST", value: "358.4", unit: "km/h" },
    { label: "Field Best", value: "362.1", unit: "Sainz", emphasis: true },
    { label: "Field Avg", value: "351.2", unit: "km/h" }
  ],
  chart: {
    type: "horizontal_bar",
    y_axis: ["Sainz", "Antonelli", "Verstappen", "Albon", "Norris", "Russell", "Hamilton", "Piastri", "Tsunoda", "Leclerc"],
    x_label: "Speed-trap top speed (km/h)",
    series: [
      { name: "ST speed", values: [362.1, 360.7, 358.4, 357.9, 357.1, 356.4, 355.8, 355.2, 354.6, 354.0], color: "" }
    ]
  },
  key_takeaways: [
    "Sainz topped the trap at 362.1 km/h with Williams's low-drag package",
    "Verstappen 3rd fastest at 358.4 km/h",
    "Field spread of 8.1 km/h reflects setup variance",
    "Verstappen took pole despite not topping the trap"
  ],
  related_questions: [
    "Show i1 / i2 trap speeds",
    "Race-trim vs qualifying-trim ST speed",
    "Compare to Baku 2025"
  ]
}

// Category 7 — Traffic & Clean-air Pace
export const trafficMock: InsightMock = {
  title: "Clean Air vs Traffic — 2025 Season",
  subtitle: "All Race Sessions - 2025",
  body: "Across the 2025 season so far, Verstappen leads in clean-air share with 412 laps in clean air vs 89 in traffic (82% clean). Norris is second at 78%. The midfield runners spent more than half their laps in traffic: Hülkenberg (61% traffic), Bortoleto (64% traffic), and Stroll (58% traffic). Clean-air pace correlates strongly with finishing position across the field.",
  metrics: [
    { label: "Most Clean-Air", value: "412", unit: "laps (VER)", emphasis: true },
    { label: "Pace Delta", value: "+0.42", unit: "sec/lap" },
    { label: "70%+ Clean", value: "5", unit: "drivers" }
  ],
  chart: {
    type: "stacked_horizontal_bar",
    y_axis: ["Verstappen", "Norris", "Piastri", "Russell", "Leclerc", "Hamilton", "Antonelli", "Sainz", "Albon", "Hülkenberg"],
    x_label: "Laps",
    series: [
      { name: "Clean Air", values: [412, 388, 372, 351, 341, 318, 287, 265, 232, 198], color: "#4ADE80" },
      { name: "In Traffic", values: [89, 110, 132, 153, 162, 184, 213, 240, 270, 308], color: "#EF4444" }
    ]
  },
  key_takeaways: [
    "Verstappen led 82% of his laps in clean air",
    "Avg traffic pace penalty: +0.42 s/lap field-wide",
    "5 drivers maintained 70%+ clean-air share",
    "Backmarkers spent >55% of laps stuck behind another car"
  ],
  related_questions: [
    "Show pace delta in traffic vs clean air",
    "Filter by stint",
    "Mexico 2025 specifically"
  ]
}

// Category 8 — Weather Impact
export const weatherMock: InsightMock = {
  title: "Inters-to-Slicks Crossover — Silverstone 2025",
  subtitle: "2025 British GP - Race",
  body: "At the 2025 British GP, both McLaren drivers made the intermediates-to-slicks crossover on lap 22, when track temperatures rose above 28°C and the dry line had fully developed. Norris pitted on lap 22 (transition to medium); Piastri followed on lap 23 (also medium). Their decision was 2 laps later than the leaders — a calculated bet that paid off when both moved up positions during the cycle.",
  metrics: [
    { label: "Norris Crossover", value: "Lap 22", emphasis: true },
    { label: "Piastri Crossover", value: "Lap 23" },
    { label: "Wet Pace Delta", value: "+8.2", unit: "sec/lap" }
  ],
  chart: {
    type: "line_dual_axis",
    x_label: "Lap",
    y1_label: "Lap time (s)",
    y2_label: "Rainfall (mm/hr)",
    series: [
      { name: "Norris", values: [98, 95, 92, 90, 89, 87, 86, 85, 85, 86, 87, 88, 89, 90, 91, 92, 93, 92, 91, 90, 89, 88, 84, 83, 83, 83, 83, 83], color: "#FF8000" },
      { name: "Piastri", values: [99, 96, 93, 91, 90, 88, 87, 86, 86, 87, 88, 89, 90, 91, 92, 93, 94, 93, 92, 91, 90, 89, 88, 84, 83, 83, 83, 83], color: "#FFB266" },
      { name: "Rainfall", values: [3, 4, 4, 5, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], color: "#3B82F6" }
    ],
    vertical_markers: [
      { x: 22, label: "Norris pits" },
      { x: 23, label: "Piastri pits" }
    ]
  },
  key_takeaways: [
    "Both McLarens crossed over on consecutive laps (22 / 23)",
    "Track temp passed 28°C threshold around lap 21",
    "McLaren's call was 2 laps later than the leader's",
    "Wet-tyre pace gap was +8.2 s/lap vs slick race pace"
  ],
  related_questions: [
    "Show all teams' crossover laps",
    "Compare to 2024 Silverstone",
    "Wet-pace ranking by team"
  ]
}

// Category 10 — Track Dominance
export const trackDominanceMock: InsightMock = {
  title: "Sector 2 Minisector Dominance — Silverstone 2025",
  subtitle: "2025 British GP - Qualifying",
  body: "Through Silverstone Sector 2 in qualifying 2025, Verstappen dominated 14 of 22 minisectors vs Norris's 8. Verstappen's strongest gains came at Maggotts (T10), Becketts (T11), and Chapel (T12) — the high-speed esses where Red Bull's downforce balance excelled. Norris reclaimed time through the Stowe complex (T15-T16) where McLaren's lower-drag setup helped.",
  metrics: [
    { label: "Verstappen", value: "14", unit: "minisectors", emphasis: true },
    { label: "Norris", value: "8", unit: "minisectors" },
    { label: "Total", value: "22" }
  ],
  chart: {
    type: "grouped_bar",
    x_axis: ["Copse", "Maggotts", "Becketts", "Chapel", "Hangar", "Stowe"],
    y_label: "Minisectors won",
    series: [
      { name: "Max Verstappen", values: [2, 3, 3, 3, 1, 2], color: "#3671C6" },
      { name: "Lando Norris", values: [0, 1, 1, 1, 2, 3], color: "#FF8000" }
    ]
  },
  key_takeaways: [
    "Verstappen 14, Norris 8 — Verstappen +6 net minisectors",
    "Verstappen dominated the high-speed esses (Maggotts to Chapel)",
    "Norris reclaimed Stowe complex (T15-T16) by ~0.08s",
    "Sector 2 net delta: Verstappen ahead by 0.18s overall"
  ],
  related_questions: [
    "Show Sector 1 dominance",
    "Compare Q2 vs Q3",
    "Add Leclerc to comparison"
  ]
}

// Category 12 — Driver Performance Radar
export const driverPerformanceMock: InsightMock = {
  title: "7-Axis Performance — Verstappen vs Norris 2025",
  subtitle: "2025 Season - Aggregate",
  body: "Across the seven Phase 21 performance axes, Verstappen leads Norris in qualifying (88 vs 82), tyre management (76 vs 71), and error-rate (95 vs 88). Norris leads in overtake-difficulty (78 vs 64) — reflecting his recovery drives from grid incidents. Race-pace and traffic-handling are roughly even. Verstappen's polygon is more uniform; Norris's shows a strength in attack at the cost of qualifying gap.",
  chart: {
    type: "radar",
    axes: ["Qualifying", "Race Pace", "Tyre Mgmt", "Restart", "Traffic", "Overtaking", "Consistency"],
    series: [
      { name: "Max Verstappen", values: [88, 90, 76, 75, 80, 64, 95], color: "#3671C6" },
      { name: "Lando Norris", values: [82, 88, 71, 100, 78, 78, 88], color: "#FF8000" }
    ]
  },
  key_takeaways: [
    "Verstappen leads on qualifying (+6), tyre management (+5), consistency (+7)",
    "Norris leads on overtake-difficulty (+14) — recovery-drive bias",
    "Restart axis: Norris 100 vs Verstappen 75",
    "Both top-tier in race-pace (90 / 88)"
  ],
  related_questions: [
    "Add Piastri to comparison",
    "Show season trend per axis",
    "Where does Norris gain on Verstappen?"
  ]
}

// Category 13 — Braking & Traction
export const brakingMock: InsightMock = {
  title: "Turn 22 Brake-Zone Performance — Saudi 2025",
  subtitle: "2025 Saudi Arabian GP - Race",
  body: "Across 41 race laps, Verstappen approached Turn 22 at an average of 318 km/h and braked down to 92 km/h — a brake-zone speed drop of 226 km/h. Peak brake pressure averaged 92.4%. The drop was consistent across the stint (std-dev 4.2 km/h), suggesting Red Bull's brake balance held up well as fuel burned off.",
  metrics: [
    { label: "Approach Speed", value: "318", unit: "km/h" },
    { label: "Min in Zone", value: "92", unit: "km/h" },
    { label: "Speed Drop", value: "226", unit: "km/h", emphasis: true }
  ],
  chart: {
    type: "line",
    x_label: "Lap",
    y_label: "Brake-zone speed drop (km/h)",
    series: [
      { name: "Verstappen", values: [225, 228, 224, 227, 226, 230, 226, 225, 228, 224, 226, 229, 227, 226, 225, 224, 226, 228, 230, 227, 225, 224, 226, 228, 226, 230, 227, 225, 224, 226, 228, 226, 225, 227, 226, 228, 227, 225, 224, 226, 228], color: "#3671C6" }
    ]
  },
  key_takeaways: [
    "Avg brake-zone speed drop: 226 km/h",
    "Peak brake pressure: 92.4%",
    "Std-dev across stint: 4.2 km/h (consistent)",
    "Brake balance stable as fuel burned off"
  ],
  related_questions: [
    "Compare to Hamilton at Turn 22",
    "Show all braking zones at Saudi",
    "Race-trim vs quali-trim brake drop"
  ]
}

// M01 — Hero Scalar
export const heroPoleLapMock: InsightMock = {
  title: "Pole Lap — Suzuka 2025",
  subtitle: "2025 Japanese GP - Qualifying Q3",
  body: "Verstappen took pole at Suzuka 2025 with a lap of 1:27.502, 0.044s ahead of Norris in P2. The lap featured a personal-best Sector 2 through the high-speed esses where Red Bull's downforce package excelled.",
  hero: {
    value: "1:27.502",
    label: "pole lap time",
    context: "+0.044s ahead of Norris (P2)"
  },
  key_takeaways: [
    "Sector 2 (esses) was the fastest of his stint",
    "Margin to P2 was the season's 4th-tightest pole",
    "Red Bull took pole at Suzuka in both 2024 and 2025"
  ],
  related_questions: [
    "Show full Q3 lap times",
    "Compare to qualifying 2024",
    "Add Hamilton's best lap"
  ]
}

// M02 — Yes/No Verdict
export const overcutVerdictMock: InsightMock = {
  title: "Over-Cut Verdict — Canada 2025",
  subtitle: "2025 Canadian GP - Race - lap 28-29",
  body: "Russell pitted on lap 29, one lap after Verstappen's lap-28 stop. With Russell on fresher mediums and Verstappen still warming up his tyres on lap 30, Russell's out-lap was 1.1s quicker than Verstappen's in-lap, and the cycle handed Russell a 1.4s lead by the end of lap 30.",
  verdict: {
    label: "YES",
    color: "#E10600",
    summary: "Russell's lap-29 stop gained track position over Verstappen by 1.4s after the cycle"
  },
  metrics: [
    { label: "Gap before", value: "1.8s", unit: "Russell behind" },
    { label: "Gap after", value: "1.4s", unit: "Russell ahead", emphasis: true },
    { label: "Net swing", value: "+3.2s" }
  ],
  key_takeaways: [
    "Russell's out-lap on fresh mediums was 1.1s faster than Verstappen's in-lap",
    "Net swing of +3.2s — clean execution by Mercedes",
    "Verstappen's tyre warm-up phase made the over-cut viable",
    "Track position held to the end of the stint"
  ],
  related_questions: [
    "Show full pit cycle",
    "Compare to Hamilton's overcut attempt",
    "Undercut vs overcut success rate"
  ]
}

// M05 — Braking Grouped Bar (variant of M04)
export const brakingGroupedMock: InsightMock = {
  title: "Heaviest Brake Zones — Bahrain 2025",
  subtitle: "2025 Bahrain GP - Race - Lap 1",
  body: "Across Bahrain's three heaviest braking zones (T1, T4, T10), Piastri's lap-1 brake-zone delta to Norris was +0.12s, +0.08s, and +0.05s respectively — and that pattern held across the opening stint, with Piastri averaging +0.09s/lap behind Norris through the deg curve.",
  chart: {
    type: "grouped_bar",
    x_axis: ["T1", "T4", "T10"],
    y_label: "Brake-zone delta to Norris (s)",
    series: [
      { name: "Lando Norris", values: [0.0, 0.0, 0.0], color: "#FF8000" },
      { name: "Oscar Piastri", values: [0.12, 0.08, 0.05], color: "#FFB266" }
    ]
  },
  key_takeaways: [
    "Piastri trailed in all 3 heaviest brake zones",
    "Lap-1 deltas predicted stint-1 pace deficit (~0.09s/lap)",
    "Largest gap at T1 — heaviest braking zone",
    "Pattern consistent through the stint"
  ],
  related_questions: [
    "Compare race-trim to qualifying",
    "Show traction zones",
    "Verstappen vs Norris braking comparison"
  ]
}

// M08 — Stint Gantt
export const stintGanttMock: InsightMock = {
  title: "Mercedes Strategy Split — Spa 2025",
  subtitle: "2025 Belgian GP - Race",
  body: "Mercedes split their two cars between a one-stop (Russell, M-H) and a two-stop (Hamilton, M-H-M). Russell's longer first stint preserved track position; Hamilton's two-stop yielded fresher rubber for the closing 12 laps and a fastest-lap point.",
  metrics: [
    { label: "Russell stops", value: "1" },
    { label: "Hamilton stops", value: "2", emphasis: true },
    { label: "Net delta", value: "+1.8s", unit: "Russell ahead" }
  ],
  chart: {
    type: "stint_gantt",
    y_axis: ["Russell", "Hamilton"],
    total_laps: 44,
    stints: [
      { driver: "Russell", start: 1, end: 22, compound: "medium", lap_times_avg: 109.4 },
      { driver: "Russell", start: 23, end: 44, compound: "hard", lap_times_avg: 110.8 },
      { driver: "Hamilton", start: 1, end: 14, compound: "medium", lap_times_avg: 109.7 },
      { driver: "Hamilton", start: 15, end: 32, compound: "hard", lap_times_avg: 110.2 },
      { driver: "Hamilton", start: 33, end: 44, compound: "medium", lap_times_avg: 109.1 }
    ],
    compound_legend: {
      hard: "#E5E7EB",
      medium: "#FCD34D",
      soft: "#EF4444",
      inter: "#22C55E",
      wet: "#3B82F6"
    }
  },
  key_takeaways: [
    "Russell ran a one-stop M→H",
    "Hamilton ran a two-stop M→H→M",
    "Hamilton's closing-stint mediums 1.1s/lap quicker than Russell's hards",
    "Net result: Russell ahead by 1.8s at flag"
  ],
  related_questions: [
    "Compare to Ferrari strategy",
    "Show undercut window",
    "Optimal strategy simulation"
  ]
}

// M10 — Line with stint markers
export const stintDeltaMock: InsightMock = {
  title: "Stint-by-Stint Deltas — Bahrain 2025",
  subtitle: "2025 Bahrain GP - Race",
  body: "Hamilton trailed Leclerc by ~0.4s/lap in stint 1 (mediums), reversed to a ~0.2s/lap advantage in stint 2 (also mediums but fresher), then trailed by ~0.6s/lap in stint 3 (hards) when Leclerc's tyre management paid off.",
  chart: {
    type: "line_with_stint_markers",
    x_label: "Lap",
    y_label: "Hamilton - Leclerc (s/lap)",
    series: [
      { name: "Hamilton - Leclerc", values: [0.4, 0.4, 0.5, 0.4, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, -0.2, -0.2, -0.1, -0.2, -0.3, -0.2, -0.1, -0.2, 0.6, 0.6, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], color: "#E80020" }
    ],
    stint_boundaries: [
      { lap: 12, label: "Pit → medium" },
      { lap: 20, label: "Pit → hard" }
    ],
    horizontal_marker: { value: 0, label: "even" }
  },
  key_takeaways: [
    "Stint 1 (medium): Hamilton −0.4s/lap",
    "Stint 2 (fresher medium): Hamilton +0.2s/lap",
    "Stint 3 (hard): Hamilton −0.6s/lap",
    "Final-stint reversal driven by Leclerc's hard-tyre management"
  ],
  related_questions: [
    "Show fuel-corrected deltas",
    "Compare to Russell vs Antonelli",
    "Add tyre deg overlay"
  ]
}

// M16 — Minisector heatmap (simplified as strip)
export const minisectorMock: InsightMock = {
  title: "Sector 2 Minisector Dominance — Silverstone 2025",
  subtitle: "2025 British GP - Qualifying - Sector 2",
  body: "Verstappen led 14 of 22 Sector 2 minisectors. Strongest gains: Maggotts (T10), Becketts (T11), Chapel (T12). Norris reclaimed Stowe complex (T15-16).",
  metrics: [
    { label: "Verstappen", value: "14", unit: "minisectors", emphasis: true },
    { label: "Norris", value: "8", unit: "minisectors" },
    { label: "Total S2", value: "22" }
  ],
  chart: {
    type: "track_heatmap",
    circuit: "Silverstone",
    sector: 2,
    view: "track_shape",
    segments: [
      { minisector_index: 23, name: "T9 Copse", leader: "Verstappen", color: "#3671C6", delta_ms: 12 },
      { minisector_index: 24, name: "T9 Copse exit", leader: "Verstappen", color: "#3671C6", delta_ms: 8 },
      { minisector_index: 25, name: "T10 Maggotts", leader: "Verstappen", color: "#3671C6", delta_ms: 22 },
      { minisector_index: 26, name: "T10 Maggotts", leader: "Verstappen", color: "#3671C6", delta_ms: 18 },
      { minisector_index: 27, name: "T11 Becketts", leader: "Verstappen", color: "#3671C6", delta_ms: 28 },
      { minisector_index: 28, name: "T11 Becketts", leader: "Verstappen", color: "#3671C6", delta_ms: 25 },
      { minisector_index: 29, name: "T12 Chapel", leader: "Verstappen", color: "#3671C6", delta_ms: 16 },
      { minisector_index: 30, name: "T13 Hangar", leader: "Norris", color: "#FF8000", delta_ms: 6 },
      { minisector_index: 31, name: "T15 Stowe", leader: "Norris", color: "#FF8000", delta_ms: 14 },
      { minisector_index: 32, name: "T16 Stowe", leader: "Norris", color: "#FF8000", delta_ms: 11 }
    ]
  },
  key_takeaways: [
    "Verstappen +6 net minisectors",
    "Verstappen dominated high-speed esses",
    "Norris reclaimed Stowe complex (T15-16)",
    "Sector 2 net delta: Verstappen +0.18s"
  ],
  related_questions: [
    "Show Sector 1 breakdown",
    "Compare Q2 vs Q3",
    "Add Leclerc"
  ]
}

// M19 — Donut chart
export const drsZoneDonutMock: InsightMock = {
  title: "DRS Zone Share — Singapore 2025",
  subtitle: "2025 Singapore GP - Race",
  body: "Of 47 on-track overtakes at Singapore 2025, the new fourth DRS zone (start-finish straight) accounted for 32 (68%). The original three zones (T2-3, T7, T14) accounted for 15 combined.",
  metrics: [
    { label: "Total overtakes", value: "47" },
    { label: "Zone 4 share", value: "68%", emphasis: true },
    { label: "Zones 1-3 share", value: "32%" }
  ],
  chart: {
    type: "donut",
    center_label: "47\novertakes",
    slices: [
      { label: "Zone 4 (new)", value: 32, color: "#E10600" },
      { label: "Zone 1 (T2-3)", value: 8, color: "#3671C6" },
      { label: "Zone 2 (T7)", value: 4, color: "#FF8000" },
      { label: "Zone 3 (T14)", value: 3, color: "#27F4D2" }
    ]
  },
  key_takeaways: [
    "New zone 4 accounted for 68% of overtakes",
    "Original three zones combined: 32%",
    "Zone 4 was the longest DRS-active stretch on the lap",
    "Highest Singapore overtake count in 5 seasons"
  ],
  related_questions: [
    "Show by-driver breakdown",
    "Compare to 2024 Singapore",
    "Overtake locations on track"
  ]
}

// M20 — Composite card
export const compositeGrainingMock: InsightMock = {
  title: "Imola — Piastri Front-Right Graining",
  subtitle: "2025 Emilia-Romagna GP - Race - stint 1",
  body: "Piastri's lap-pace fell off a cliff over laps 14-16 before his lap-17 stop, with deltas of +0.4, +0.7, +1.1 s/lap to his stint-best. The cliff coincided with the team's radio call about front-right graining.",
  verdict: {
    label: "YES",
    color: "#E10600",
    summary: "Pace cliff lap 14-16, stop lap 17"
  },
  composite: [
    {
      type: "line",
      title: "Pace cliff (laps 1-17)",
      x_label: "Lap",
      y_label: "Δ to stint-best (s)",
      series: [
        { name: "Piastri", color: "#FF8000", values: [0.0, 0.05, 0.08, 0.1, 0.12, 0.15, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.3, 0.4, 0.7, 1.1, 1.4] }
      ],
      vertical_markers: [{ x: 14, label: "Cliff" }, { x: 17, label: "Pit" }]
    },
    {
      type: "metric_grid_3",
      title: "Cliff metrics",
      metrics: [
        { label: "Cliff onset", value: "Lap 14" },
        { label: "Δ at lap 16", value: "+1.1 s/lap", emphasis: true },
        { label: "Stop lap", value: "17" }
      ]
    }
  ],
  key_takeaways: [
    "Cliff began lap 14, accelerated lap 16",
    "+1.1 s/lap on the final pre-stop lap",
    "Stop on lap 17 was reactive, not strategic",
    "Front-right radio call confirmed by lap-pace pattern"
  ],
  related_questions: [
    "Compare to Norris's deg",
    "Show tyre temps if available",
    "Stint 2 performance"
  ]
}

// M21 — No-data refusal
export const noDataBrakeTempMock: InsightMock = {
  title: "Not in dataset — Brake temperatures",
  subtitle: "Hamilton - Monza 2025 - Turn 8",
  tone: "muted",
  body: "Brake temperatures aren't part of the OpenF1 public telemetry feed. We ingest car_data (speed, throttle, brake on/off, n_gear, RPM, DRS), location, lap times, weather, and race control — but not internal component telemetry like brake/tyre temps, fuel flow, or ERS state-of-charge.",
  what_we_have: [
    "Speed at any sample point on the lap",
    "Brake-pedal on/off state and pressure proxy",
    "Throttle application percentage",
    "Lap-time deltas through the brake zone"
  ],
  related_questions: [
    "What was Hamilton's speed entering Turn 8?",
    "Compare brake-zone deceleration at Turn 8",
    "Show throttle-application timing out of Turn 8"
  ]
}

// M22 — Pit event strip
export const pitEventMock: InsightMock = {
  title: "Verstappen First Stop — Canada 2025",
  subtitle: "2025 Canadian GP - Race",
  body: "Verstappen made his first stop on lap 28 of 70, switching from medium to hard. The stop lasted 2.4s stationary; total pit-loss was 21.8s. He emerged in P3 and recovered to P1 by lap 42.",
  metrics: [
    { label: "Stop lap", value: "28", emphasis: true },
    { label: "Stationary", value: "2.4", unit: "sec" },
    { label: "Total pit loss", value: "21.8", unit: "sec" }
  ],
  chart: {
    type: "pit_event_strip",
    phases: [
      { label: "In-lap (27)", duration_sec: 78.2, color: "#9CA3AF" },
      { label: "Pit lane", duration_sec: 21.8, color: "#E10600" },
      { label: "Out-lap (29)", duration_sec: 79.4, color: "#9CA3AF" }
    ],
    post_cycle: {
      before_position: 1,
      after_position: 3,
      recovered_by_lap: 42
    }
  },
  key_takeaways: [
    "Stop lap 28 of 70 (40% race distance)",
    "Stationary time 2.4s — clean stop",
    "Cycle dropped him from P1 → P3",
    "Recovered to P1 by lap 42"
  ],
  related_questions: [
    "Show Russell's covering stop",
    "Compare pit losses field-wide",
    "Undercut window analysis"
  ]
}

// Category 14 — Data Health & Coverage
export const dataHealthMock: InsightMock = {
  title: "Telemetry-Weather Coverage Gap — 2025",
  subtitle: "All Sessions - 2025",
  body: "Across the 2025 season, 8 sessions show full car-data coverage but missing or partial weather data. The gap concentrates at Lusail (Qatar Sprint + Race both at 0 weather rows) and Mexico City (Race + Qualifying both partial). The reverse gap (weather but no telemetry) appears in 3 sessions, all early-season practice sessions where the car-data ingest pipeline was paused.",
  metrics: [
    { label: "Telemetry-only Gap", value: "8", unit: "sessions" },
    { label: "Weather-only Gap", value: "3", unit: "sessions" },
    { label: "Full Coverage", value: "109", unit: "sessions", emphasis: true }
  ],
  chart: {
    type: "status_grid",
    rows: [
      { label: "Lusail Qualifying", car_data: "full", weather: "missing", laps: "full" },
      { label: "Lusail Sprint", car_data: "full", weather: "missing", laps: "full" },
      { label: "Lusail Race", car_data: "full", weather: "missing", laps: "full" },
      { label: "Mexico Race", car_data: "full", weather: "partial", laps: "full" },
      { label: "Mexico Qualifying", car_data: "full", weather: "partial", laps: "full" }
    ],
    legend: {
      full: "#22C55E",
      partial: "#F59E0B",
      missing: "#EF4444"
    }
  },
  key_takeaways: [
    "Lusail (Qatar) entirely missing weather rows — 3 sessions affected",
    "Mexico City has partial weather (lap-by-lap incomplete)",
    "3 early-season practice sessions: weather present, telemetry paused",
    "Full coverage on 109 of 120 sessions (90.8%)"
  ],
  related_questions: [
    "Per-driver telemetry coverage",
    "Show session_completeness scores",
    "Compare to 2024 coverage"
  ]
}

// All mocks for demo — all 23 visualization patterns
export const allMocks = [
  // Tier 1 - High frequency
  { category: "M01: Hero Scalar", mock: heroPoleLapMock },
  { category: "M02: Yes/No Verdict", mock: overcutVerdictMock },
  { category: "M03: 3-Tile Metric", mock: brakingMock },
  { category: "M04: Corner Grouped Bar", mock: cornerAnalysisMock },
  { category: "M05: Braking Grouped Bar", mock: brakingGroupedMock },
  { category: "M06: Horizontal Bar Ranking", mock: pitStrategyMock },
  { category: "M08: Stint Gantt", mock: stintGanttMock },
  { category: "M09: Multi-line Lap Chart", mock: lapPaceMock },
  { category: "M10: Line with Stint Markers", mock: stintDeltaMock },
  { category: "M11: Scatter + Regression", mock: tyreStrategyMock },
  { category: "M12: Diverging Bar", mock: restartMock },
  { category: "M13: Stacked Horizontal Bar", mock: trafficMock },
  { category: "M14: Dual-Axis Line", mock: weatherMock },
  { category: "M15: Event Timeline", mock: incidentsMock },
  { category: "M16: Minisector Heatmap", mock: minisectorMock },
  { category: "M17: Radar Chart", mock: driverPerformanceMock },
  { category: "M18: Status Grid", mock: dataHealthMock },
  { category: "M19: Donut Chart", mock: drsZoneDonutMock },
  { category: "M20: Composite Card", mock: compositeGrainingMock },
  { category: "M21: No-Data Refusal", mock: noDataBrakeTempMock },
  { category: "M22: Pit Event Strip", mock: pitEventMock },
  { category: "M06b: Speed Trap Ranking", mock: straightLineSpeedMock },
  { category: "M06c: Overtake Ranking", mock: overtakingMock }
]
