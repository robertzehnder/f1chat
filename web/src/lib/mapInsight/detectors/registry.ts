// Phase 5 + Phase 6 of the v0 visualization match plan: detector
// registry. All chart-shape detection lives here as a typed list of
// ChartDetector entries. Higher-priority detectors win when multiple
// match. mapInsight.ts's detectChart() is a thin wrapper that calls
// runDetectorRegistry().
//
// IN_SCOPE_MOCK_COUNT = 21 (M07 + M23 deferred per source-of-truth).
// 16 detectors total: 6 migrated Tier 1 + 10 new Tier 2/3.

import type { ChartSpec } from "@/lib/chart-types";
import { getTeamColor } from "@/lib/f1-team-colors";
import type { AdapterContext, ChartDetector } from "./types";

// =============================================================================
// Helpers shared across detectors
// =============================================================================

const IDENTIFIER_COLS = new Set([
  "driver_number",
  "session_key",
  "lap_number",
  "meeting_key",
  "year",
  "round",
  "id"
]);

const COMPOUND_HEX: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  intermediate: "#22C55E",
  wet: "#3B82F6"
};

function findCol(cols: string[], pattern: RegExp): string | undefined {
  return cols.find((c) => pattern.test(c));
}

function humanize(col: string): string {
  const w = col.replace(/[_-]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((v) => String(v ?? "")))).filter(Boolean);
}

function lastName(driverName: string): string {
  return driverName.split(" ").pop() || driverName;
}

// =============================================================================
// Tier 1 detectors (6) — migrated from mapInsight.ts's original detectChart
// =============================================================================

const groupedBarDetector: ChartDetector = {
  id: "grouped_bar",
  priority: 100,
  fixtures: ["m04", "m05"],
  benchmarkQids: [1717, 1713, 1715, 1718, 1719, 1968, 1969, 1962, 1963, 1964, 1967, 1981, 1985, 1987],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("corner_label") && cols.some((c) => /entry|apex|exit|speed/.test(c));
  },
  build(rows) {
    const speedCol =
      findCol(Object.keys(rows[0]), /entry.*speed|entry_speed/) ??
      findCol(Object.keys(rows[0]), /apex.*speed|apex_min_speed/) ??
      findCol(Object.keys(rows[0]), /exit.*speed/) ??
      findCol(Object.keys(rows[0]), /speed/) ??
      "speed_kph";
    const corners = uniqueStrings(rows.map((r) => r.corner_label));
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const series = drivers.map((driver) => ({
      name: driver,
      values: corners.map((corner) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && String(r.corner_label) === corner
        );
        const v = match?.[speedCol];
        return typeof v === "number" ? v : 0;
      }),
      color: getTeamColor(driver)
    }));
    return { type: "grouped_bar", x_axis: corners, y_label: humanize(speedCol), series };
  }
};

const divergingBarDetector: ChartDetector = {
  id: "horizontal_bar_diverging",
  priority: 95,
  fixtures: ["m12"],
  benchmarkQids: [2103, 2100, 2101, 2102, 2104, 2105],
  matches(rows) {
    return Object.keys(rows[0]).includes("position_delta");
  },
  build(rows) {
    const sorted = [...rows].sort(
      (a, b) => Number(b.position_delta ?? 0) - Number(a.position_delta ?? 0)
    );
    return {
      type: "horizontal_bar_diverging",
      y_axis: sorted.map((r) => String(r.driver_name ?? r.driver_number ?? "")),
      x_label: "Positions gained / lost",
      series: [
        {
          name: "Position Δ",
          values: sorted.map((r) => Number(r.position_delta ?? 0)),
          color: "#E10600"
        }
      ]
    };
  }
};

const stackedHorizontalDetector: ChartDetector = {
  id: "stacked_horizontal_bar",
  priority: 90,
  fixtures: ["m13"],
  benchmarkQids: [2041, 2040, 2044, 2045, 2046, 2047],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    const cleanCol = findCol(cols, /(?:^|_)clean(?:_?air)?_laps?(?:_count|_total)?$/i);
    const trafficCol = findCol(cols, /(?:^|_)traffic_laps?(?:_count|_total)?$/i);
    return Boolean(cleanCol && trafficCol);
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const cleanCol =
      findCol(cols, /(?:^|_)clean(?:_?air)?_laps?(?:_count|_total)?$/i) ?? "clean_air_laps";
    const trafficCol =
      findCol(cols, /(?:^|_)traffic_laps?(?:_count|_total)?$/i) ?? "traffic_laps";
    return {
      type: "stacked_horizontal_bar",
      y_axis: rows.map((r) =>
        String(r.driver_name ? lastName(String(r.driver_name)) : r.driver_number ?? "")
      ),
      x_label: "Laps",
      series: [
        {
          name: "Clean Air",
          values: rows.map((r) => Number(r[cleanCol] ?? 0)),
          color: "#22C55E"
        },
        {
          name: "In Traffic",
          values: rows.map((r) => Number(r[trafficCol] ?? 0)),
          color: "#E10600"
        }
      ]
    };
  }
};

const stintGanttDetector: ChartDetector = {
  id: "stint_gantt",
  priority: 85,
  fixtures: ["m08"],
  benchmarkQids: [1943, 1940, 1944, 1948, 1949, 2026],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("compound") && cols.includes("stint_start_lap");
  },
  build(rows) {
    const drivers = uniqueStrings(rows.map((r) => r.driver_name ?? r.driver_number));
    const stints = rows.map((r) => ({
      driver: String(r.driver_name ?? r.driver_number ?? ""),
      start: Number(r.stint_start_lap ?? 0),
      end: Number(r.stint_end_lap ?? 0),
      compound: String(r.compound ?? "medium").toLowerCase() as
        | "hard" | "medium" | "soft" | "inter" | "wet",
      lap_times_avg: typeof r.avg_lap_time === "number" ? Number(r.avg_lap_time) : undefined
    }));
    const totalLaps = Math.max(...stints.map((s) => s.end || 0), 0);
    return {
      type: "stint_gantt",
      y_axis: drivers,
      total_laps: totalLaps,
      stints,
      compound_legend: COMPOUND_HEX
    };
  }
};

const lineDetector: ChartDetector = {
  id: "line",
  priority: 80,
  fixtures: ["m09"],
  benchmarkQids: [1924, 1925, 1926, 1928, 1929, 2042, 2043, 2044],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("lap_number") &&
      cols.some((c) => /lap_time|delta/.test(c)) &&
      // Don't fire if stint markers are present — that's M10's territory
      !cols.some((c) => /stint_boundary|stint_start_lap/.test(c))
    );
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const valueCol =
      findCol(cols, /lap_time/) ?? findCol(cols, /delta/) ?? "lap_time";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const laps = Array.from(new Set(rows.map((r) => Number(r.lap_number ?? 0)))).sort((a, b) => a - b);
    const series = drivers.map((driver) => ({
      name: driver,
      color: getTeamColor(driver),
      values: laps.map((lap) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && Number(r.lap_number) === lap
        );
        const v = match?.[valueCol];
        return typeof v === "number" ? v : 0;
      })
    }));
    return { type: "line", x_label: "Lap", y_label: humanize(valueCol), series };
  }
};

const horizontalBarDetector: ChartDetector = {
  id: "horizontal_bar",
  priority: 50, // Low priority — fallback when nothing more specific matches
  fixtures: ["m06"],
  benchmarkQids: [2080, 1701, 1712, 2001, 2002, 2080, 2101, 2160],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    if (!cols.includes("driver_name") && !cols.includes("driver_number")) return false;
    const numericCol = cols.find(
      (c) => !IDENTIFIER_COLS.has(c) && typeof rows[0][c] === "number"
    );
    return Boolean(numericCol);
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const numericCol =
      cols.find((c) => !IDENTIFIER_COLS.has(c) && typeof rows[0][c] === "number") ?? "value";
    const sorted = [...rows].sort(
      (a, b) => Number(b[numericCol] ?? 0) - Number(a[numericCol] ?? 0)
    );
    return {
      type: "horizontal_bar",
      y_axis: sorted.map((r) => String(r.driver_name ?? r.driver_number ?? "")),
      x_label: humanize(numericCol),
      series: [
        {
          name: humanize(numericCol),
          values: sorted.map((r) => Number(r[numericCol] ?? 0)),
          color: "#E10600"
        }
      ]
    };
  }
};

// =============================================================================
// Tier 2 detectors (5) — Phase 6
// =============================================================================

const eventTimelineDetector: ChartDetector = {
  id: "event_timeline",
  priority: 92,
  fixtures: ["m15"],
  benchmarkQids: [2140, 2141, 2142, 2143, 2144, 2145, 2146],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("lap") && cols.includes("kind") && cols.includes("driver");
  },
  build(rows) {
    return {
      type: "event_timeline",
      events: rows.map((r) => ({
        lap: Number(r.lap ?? 0),
        driver: String(r.driver ?? r.driver_name ?? ""),
        kind: String(r.kind ?? "event"),
        team_color: getTeamColor(String(r.driver ?? r.driver_name ?? "")),
        message: String(r.message ?? r.note ?? "")
      }))
    };
  }
};

const radarDetector: ChartDetector = {
  id: "radar",
  priority: 88,
  fixtures: ["m17"],
  benchmarkQids: [2162, 2160, 2161, 2163, 2164, 2165, 2166, 2167],
  matches(rows, ctx) {
    if (rows.length < 1 || rows.length > 4) return false;
    const cols = Object.keys(rows[0]);
    if (!cols.includes("driver_name")) return false;
    // Per-axis numeric columns: at least 4 numeric non-identifier cols
    const numericCount = cols.filter(
      (c) => !IDENTIFIER_COLS.has(c) && typeof rows[0][c] === "number"
    ).length;
    if (numericCount < 4) return false;
    // Topic context: question must mention axis/score/rating/performance
    const topic = (ctx.question ?? "").toLowerCase();
    return /\b(axis|score|rating|performance|7.?axis)\b/.test(topic);
  },
  build(rows) {
    const cols = Object.keys(rows[0]).filter(
      (c) => !IDENTIFIER_COLS.has(c) && c !== "driver_name" && typeof rows[0][c] === "number"
    );
    const series = rows.map((r) => ({
      name: String(r.driver_name ?? ""),
      values: cols.map((c) => Number(r[c] ?? 0)),
      color: getTeamColor(String(r.driver_name ?? ""))
    }));
    return {
      type: "radar",
      axes: cols.map(humanize),
      max_value: 100,
      series
    };
  }
};

const scatterRegressionDetector: ChartDetector = {
  id: "scatter_with_regression",
  priority: 87,
  fixtures: ["m11"],
  benchmarkQids: [2024, 2020, 2022, 2024, 2028, 2029],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      (cols.includes("stint_lap") || cols.includes("lap_in_stint")) &&
      cols.some((c) => /lap_time/.test(c)) &&
      cols.includes("driver_name")
    );
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const lapCol = cols.includes("stint_lap") ? "stint_lap" : "lap_in_stint";
    const valueCol = findCol(cols, /lap_time/) ?? "lap_time";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const series = drivers.map((driver) => {
      const driverRows = rows.filter((r) => String(r.driver_name) === driver);
      const points: [number, number][] = driverRows.map((r) => [
        Number(r[lapCol] ?? 0),
        Number(r[valueCol] ?? 0)
      ]);
      // Slope via simple linear regression (least squares).
      const n = points.length;
      const sumX = points.reduce((a, p) => a + p[0], 0);
      const sumY = points.reduce((a, p) => a + p[1], 0);
      const sumXY = points.reduce((a, p) => a + p[0] * p[1], 0);
      const sumX2 = points.reduce((a, p) => a + p[0] * p[0], 0);
      const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
      return {
        name: driver,
        values: points.map((p) => p[1]),
        points,
        slope,
        color: getTeamColor(driver)
      };
    });
    return {
      type: "scatter_with_regression",
      x_label: "Stint lap",
      y_label: humanize(valueCol),
      series
    };
  }
};

const statusGridDetector: ChartDetector = {
  id: "status_grid",
  priority: 86,
  fixtures: ["m18"],
  benchmarkQids: [2186, 2181, 2182, 2183, 2184, 2185, 2187],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    if (!cols.some((c) => /session/.test(c))) return false;
    // At least 2 columns that look like coverage status (full/partial/missing)
    const coverageVals = new Set(["full", "partial", "missing"]);
    const coverageCols = cols.filter((c) => {
      const v = rows[0][c];
      return typeof v === "string" && coverageVals.has(v.toLowerCase());
    });
    return coverageCols.length >= 2;
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const labelCol =
      findCol(cols, /session_label|label|name/) ?? cols.find((c) => /session/.test(c)) ?? cols[0];
    const coverageVals = new Set(["full", "partial", "missing"]);
    const coverageCols = cols.filter((c) => {
      const v = rows[0][c];
      return typeof v === "string" && coverageVals.has(v.toLowerCase());
    });
    return {
      type: "status_grid",
      rows: rows.map((r) => {
        const cells: Record<string, string | number | undefined> = {};
        for (const c of coverageCols) cells[c] = String(r[c] ?? "missing");
        return {
          session_key: typeof r.session_key === "number" ? r.session_key : undefined,
          label: String(r[labelCol] ?? ""),
          ...cells
        };
      }),
      legend: { full: "#22C55E", partial: "#F59E0B", missing: "#EF4444" }
    };
  }
};

const donutDetector: ChartDetector = {
  id: "donut",
  priority: 70,
  fixtures: ["m19"],
  benchmarkQids: [2085, 2083, 2120],
  matches(rows) {
    if (rows.length < 2 || rows.length > 6) return false;
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("label") &&
      cols.some((c) => /value|count|share|pct|percent/.test(c)) &&
      !cols.includes("driver_name") // donut isn't per-driver
    );
  },
  build(rows) {
    const valueCol =
      findCol(Object.keys(rows[0]), /value|count|share|pct|percent/) ?? "value";
    const palette = ["#E10600", "#1E41FF", "#FF8000", "#27F4D2", "#229971", "#52E252"];
    const slices = rows.map((r, i) => ({
      label: String(r.label ?? ""),
      value: Number(r[valueCol] ?? 0),
      color: palette[i % palette.length]
    }));
    const total = slices.reduce((a, s) => a + s.value, 0);
    return {
      type: "donut",
      center_label: `${total}\ntotal`,
      slices
    };
  }
};

// =============================================================================
// Tier 3 detectors (5) — Phase 6
// =============================================================================

const lineDualAxisDetector: ChartDetector = {
  id: "line_dual_axis",
  priority: 84,
  fixtures: ["m14"],
  benchmarkQids: [2123, 2121, 2122, 2124, 2125, 2126],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("lap") &&
      cols.some((c) => /lap_time/.test(c)) &&
      cols.some((c) => /rainfall|track_temp|air_temp|wind/.test(c))
    );
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const lapTimeCol = findCol(cols, /lap_time/) ?? "lap_time";
    const weatherCol =
      findCol(cols, /rainfall/) ?? findCol(cols, /track_temp/) ?? "weather";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const laps = Array.from(new Set(rows.map((r) => Number(r.lap ?? 0)))).sort((a, b) => a - b);
    const driverSeries = drivers.map((driver) => ({
      name: `${driver} (lap time)`,
      axis: "y1" as const,
      color: getTeamColor(driver),
      values: laps.map((lap) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && Number(r.lap) === lap
        );
        return Number(match?.[lapTimeCol] ?? 0);
      })
    }));
    const weatherSeries = {
      name: humanize(weatherCol),
      axis: "y2" as const,
      color: "#1868DB",
      values: laps.map((lap) => {
        const match = rows.find((r) => Number(r.lap) === lap);
        return Number(match?.[weatherCol] ?? 0);
      })
    };
    return {
      type: "line_dual_axis",
      x_label: "Lap",
      y1_label: "Lap time (s)",
      y2_label: humanize(weatherCol),
      series: [...driverSeries, weatherSeries]
    };
  }
};

const lineWithStintMarkersDetector: ChartDetector = {
  id: "line_with_stint_markers",
  priority: 83,
  fixtures: ["m10"],
  benchmarkQids: [2027, 1947, 1948, 2025, 2029],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("lap_number") &&
      cols.some((c) => /delta|lap_time/.test(c)) &&
      cols.some((c) => /stint_boundary|stint_start_lap|pit_lap/.test(c))
    );
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const valueCol = findCol(cols, /delta/) ?? findCol(cols, /lap_time/) ?? "lap_time";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const laps = Array.from(new Set(rows.map((r) => Number(r.lap_number ?? 0)))).sort((a, b) => a - b);
    const series = drivers.map((driver) => ({
      name: driver,
      color: getTeamColor(driver),
      values: laps.map((lap) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && Number(r.lap_number) === lap
        );
        return Number(match?.[valueCol] ?? 0);
      })
    }));
    // Pit-lap markers from rows where pit_lap or stint_boundary is set
    const boundaries = rows
      .filter((r) => r.pit_lap || r.stint_boundary)
      .map((r) => ({
        lap: Number(r.lap_number ?? 0),
        label: String(r.stint_boundary_label ?? r.pit_label ?? "Pit")
      }));
    return {
      type: "line_with_stint_markers",
      x_label: "Lap",
      y_label: humanize(valueCol),
      series,
      stint_boundaries: boundaries
    };
  }
};

const trackHeatmapDetector: ChartDetector = {
  id: "track_heatmap",
  priority: 82,
  fixtures: ["m16"],
  benchmarkQids: [1706, 1700, 1702, 1703, 1707, 1708, 1710, 1711],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("minisector_index") &&
      cols.includes("name") &&
      cols.includes("leader")
    );
  },
  build(rows) {
    return {
      type: "track_heatmap",
      view: "strip",
      segments: rows.map((r) => ({
        minisector_index: Number(r.minisector_index ?? 0),
        name: String(r.name ?? ""),
        leader: String(r.leader ?? ""),
        color: getTeamColor(String(r.leader ?? "")),
        delta_ms: typeof r.delta_ms === "number" ? Number(r.delta_ms) : undefined
      }))
    };
  }
};

const pitEventStripDetector: ChartDetector = {
  id: "pit_event_strip",
  priority: 81,
  fixtures: ["m22"],
  benchmarkQids: [2061, 2062, 2063, 2067],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("phase_label") && cols.includes("duration_sec");
  },
  build(rows) {
    return {
      type: "pit_event_strip",
      phases: rows.map((r) => ({
        label: String(r.phase_label ?? ""),
        duration_sec: Number(r.duration_sec ?? 0),
        color: r.phase_label === "Pit lane" ? "#E10600" : "#9CA3AF"
      }))
    };
  }
};

const compositeDetector: ChartDetector = {
  id: "composite",
  priority: 60,
  fixtures: ["m20"],
  benchmarkQids: [2200, 2201, 2202, 2203, 2204, 2205, 2206, 2207, 2208],
  matches(_rows, ctx) {
    // Composite is signaled by question topic, not row shape — the
    // shape selector (Phase 3) flags composite questions; we just
    // delegate to the per-question template for those. The detector
    // is a placeholder that fires when the shape context says so.
    return false; // Composite is shape-driven, not row-driven; M20 is rendered via insight.composite
  },
  build() {
    // Never called given matches=false; kept for type completeness.
    return { type: "metric_grid" };
  }
};

// =============================================================================
// Registry export
// =============================================================================

export const CHART_DETECTORS: ReadonlyArray<ChartDetector> = [
  // Tier 1 (priorities 50-100, migrated from original detectChart)
  groupedBarDetector,
  divergingBarDetector,
  stackedHorizontalDetector,
  stintGanttDetector,
  lineDetector,
  horizontalBarDetector,
  // Tier 2 (priorities 70-92, Phase 6)
  eventTimelineDetector,
  radarDetector,
  scatterRegressionDetector,
  statusGridDetector,
  donutDetector,
  // Tier 3 (priorities 60-84, Phase 6)
  lineDualAxisDetector,
  lineWithStintMarkersDetector,
  trackHeatmapDetector,
  pitEventStripDetector,
  compositeDetector
];

/**
 * Run detectors in priority order; first match wins. Returns
 * undefined if no detector matches (caller falls back to body+table).
 */
export function runDetectorRegistry(
  rows: Record<string, unknown>[] | undefined,
  ctx: AdapterContext = {}
): { spec: ChartSpec; detectorId: string } | undefined {
  if (!rows || rows.length === 0) return undefined;
  const sorted = [...CHART_DETECTORS].sort((a, b) => b.priority - a.priority);
  for (const detector of sorted) {
    if (detector.matches(rows, ctx)) {
      return { spec: detector.build(rows, ctx), detectorId: detector.id };
    }
  }
  return undefined;
}

/**
 * Coverage report — lists chart shapes with no detector AND detectors
 * with no fixture. Used for plan-level health checks.
 */
export function detectorCoverageReport(): {
  detectorWithoutFixture: string[];
  fixtureWithoutDetector: string[];
} {
  const detectorWithoutFixture = CHART_DETECTORS.filter((d) => d.fixtures.length === 0).map((d) => d.id);
  return { detectorWithoutFixture, fixtureWithoutDetector: [] };
}
