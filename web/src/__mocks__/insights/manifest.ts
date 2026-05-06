// V0 fixture manifest — single source of truth for which mocks ship,
// what chart type each one represents, which renderer it goes through,
// and which benchmark qids it covers.
//
// This file is the typed equivalent of the source-of-truth doc at
// `diagnostic/v0_visual_source_of_truth.md`. Phase 1 of the merged
// plan defines the manifest as the authoritative inventory; /mock
// reads from here and filters by `status === "implemented"` so the
// rendered count cannot drift from the declared baseline.
//
// IN_SCOPE_MOCK_COUNT is implicitly the count of entries with
// `status === "implemented"`. Today: 21 (M07 + M23 are deferred to a
// follow-up plan — see source-of-truth doc Decision 2).

import type { InsightMock } from "@/lib/chart-types";

import { m01 } from "./m01-hero";
import { m02 } from "./m02-yes-no";
import { m03 } from "./m03-metric-grid";
import { m04 } from "./m04-corner-grouped-bar";
import { m05 } from "./m05-braking-grouped-bar";
import { m06 } from "./m06-ranking-bar";
import { m08 } from "./m08-stint-gantt";
import { m09 } from "./m09-multi-line";
import { m10 } from "./m10-line-stint-markers";
import { m11 } from "./m11-scatter-regression";
import { m12 } from "./m12-diverging-bar";
import { m13 } from "./m13-stacked-horizontal";
import { m14 } from "./m14-dual-axis-line";
import { m15 } from "./m15-event-timeline";
import { m16 } from "./m16-minisector-heatmap";
import { m17 } from "./m17-radar";
import { m18 } from "./m18-status-grid";
import { m19 } from "./m19-donut";
import { m20 } from "./m20-cross-cat-composite";
import { m21 } from "./m21-no-data-refusal";
import { m22 } from "./m22-pit-cycle-event";

/** Status: `implemented` ships in /mock; `follow_up` is enumerated
 *  but not rendered (M07 + M23 — Decision 2 in source-of-truth). */
export type MockStatus = "implemented" | "follow_up";

export interface InsightFixtureManifestEntry {
  id: string;
  /** Human-readable mock title (matches v0's brief). */
  title: string;
  /** Chart type the mock represents — empty string for hero/verdict/refusal. */
  chartType: string;
  /** Renderer name the mock goes through — for hero/verdict/refusal,
   *  this is the InsightCard slot, not a ChartRenderer case. */
  renderer: string;
  /** v0 source export name in `_source.ts` (or null if follow-up). */
  sourceExport: string | null;
  status: MockStatus;
  /** Benchmark qids this mock covers. Pulled from
   *  diagnostic/phase26_v0_visualization_brief_2026-05-05.md §
   *  "Quick lookup — qid to mock-id". */
  benchmarkQids: number[];
  /** The actual InsightMock object — null for follow-up entries. */
  mock: InsightMock | null;
}

export const INSIGHT_FIXTURES: ReadonlyArray<InsightFixtureManifestEntry> = [
  {
    id: "m01",
    title: "Hero scalar — pole lap, fastest lap, total overtakes",
    chartType: "",
    renderer: "HeroScalar",
    sourceExport: "heroPoleLapMock",
    status: "implemented",
    benchmarkQids: [1922, 1920, 1940, 1941, 2000, 2060, 2080, 2120, 2160, 2180],
    mock: m01
  },
  {
    id: "m02",
    title: "Yes/No verdict",
    chartType: "",
    renderer: "VerdictCard",
    sourceExport: "overcutVerdictMock",
    status: "implemented",
    benchmarkQids: [
      2062, 1903, 1943, 1945, 1947, 2004, 2065, 2086, 2120, 2200, 2201, 2202,
      2203, 2204, 2205, 2206, 2207, 2208
    ],
    mock: m02
  },
  {
    id: "m03",
    title: "3-tile metric grid",
    chartType: "metric_grid",
    renderer: "MetricGrid",
    sourceExport: "brakingMock",
    status: "implemented",
    benchmarkQids: [1960, 1710, 1714, 1980, 2061],
    mock: m03
  },
  {
    id: "m04",
    title: "Corner-comparison grouped bar",
    chartType: "grouped_bar",
    renderer: "GroupedBarChart",
    sourceExport: "cornerAnalysisMock",
    status: "implemented",
    benchmarkQids: [1717, 1713, 1715, 1718, 1719, 1968],
    mock: m04
  },
  {
    id: "m05",
    title: "Braking-zone grouped bar",
    chartType: "grouped_bar",
    renderer: "GroupedBarChart (DeltaComparison variant)",
    sourceExport: "brakingGroupedMock",
    status: "implemented",
    benchmarkQids: [1969, 1962, 1963, 1964, 1967, 1981, 1985, 1987],
    mock: m05
  },
  {
    id: "m06",
    title: "Field-wide ranking bar",
    chartType: "horizontal_bar",
    renderer: "HorizontalBarChart",
    sourceExport: "overtakingMock",
    status: "implemented",
    benchmarkQids: [2080, 1701, 1712, 2001, 2002, 2080, 2101, 2160],
    mock: m06
  },
  {
    id: "m07",
    title: "Team-grouped horizontal bar (with team-color side strip)",
    chartType: "horizontal_bar_team_grouped",
    renderer: "TeamGroupedHorizontalBarChart (FOLLOW-UP)",
    sourceExport: null,
    status: "follow_up",
    benchmarkQids: [2000, 2003, 2006, 2007, 2009],
    mock: null
  },
  {
    id: "m08",
    title: "Stint Gantt strip",
    chartType: "stint_gantt",
    renderer: "StintGantt",
    sourceExport: "stintGanttMock",
    status: "implemented",
    benchmarkQids: [1943, 1940, 1944, 1948, 1949, 2026],
    mock: m08
  },
  {
    id: "m09",
    title: "Multi-line lap-time chart",
    chartType: "line",
    renderer: "LineChart",
    sourceExport: "lapPaceMock",
    status: "implemented",
    benchmarkQids: [1924, 1925, 1926, 1928, 1929, 2042, 2043, 2044],
    mock: m09
  },
  {
    id: "m10",
    title: "Line with stint-boundary markers",
    chartType: "line_with_stint_markers",
    renderer: "LineWithStintMarkers",
    sourceExport: "stintDeltaMock",
    status: "implemented",
    benchmarkQids: [2027, 1947, 1948, 2025, 2029],
    mock: m10
  },
  {
    id: "m11",
    title: "Scatter with regression line",
    chartType: "scatter_with_regression",
    renderer: "ScatterChart",
    sourceExport: "tyreStrategyMock",
    status: "implemented",
    benchmarkQids: [2024, 2020, 2022, 2024, 2028, 2029],
    mock: m11
  },
  {
    id: "m12",
    title: "Lap-1 / restart diverging bar",
    chartType: "horizontal_bar_diverging",
    renderer: "DivergingBarChart",
    sourceExport: "restartMock",
    status: "implemented",
    benchmarkQids: [2103, 2100, 2101, 2102, 2104, 2105],
    mock: m12
  },
  {
    id: "m13",
    title: "Stacked horizontal bar (clean-air vs traffic)",
    chartType: "stacked_horizontal_bar",
    renderer: "StackedHorizontalBarChart",
    sourceExport: "trafficMock",
    status: "implemented",
    benchmarkQids: [2041, 2040, 2044, 2045, 2046, 2047],
    mock: m13
  },
  {
    id: "m14",
    title: "Dual-axis line chart (lap time + weather)",
    chartType: "line_dual_axis",
    renderer: "LineDualAxisChart",
    sourceExport: "weatherMock",
    status: "implemented",
    benchmarkQids: [2123, 2121, 2122, 2124, 2125, 2126],
    mock: m14
  },
  {
    id: "m15",
    title: "Event timeline (steward decisions)",
    chartType: "event_timeline",
    renderer: "TimelineChart",
    sourceExport: "incidentsMock",
    status: "implemented",
    benchmarkQids: [2140, 2141, 2142, 2143, 2144, 2145, 2146],
    mock: m15
  },
  {
    id: "m16",
    title: "Track-shape minisector heatmap",
    chartType: "track_heatmap",
    renderer: "MinisectorStrip",
    sourceExport: "trackDominanceMock",
    status: "implemented",
    benchmarkQids: [1706, 1700, 1702, 1703, 1707, 1708, 1710, 1711],
    mock: m16
  },
  {
    id: "m17",
    title: "Radar (7-axis driver score)",
    chartType: "radar",
    renderer: "RadarChart",
    sourceExport: "driverPerformanceMock",
    status: "implemented",
    benchmarkQids: [2162, 2160, 2161, 2163, 2164, 2165, 2166, 2167],
    mock: m17
  },
  {
    id: "m18",
    title: "Status grid (data health)",
    chartType: "status_grid",
    renderer: "StatusGridChart",
    sourceExport: "dataHealthMock",
    status: "implemented",
    benchmarkQids: [2186, 2181, 2182, 2183, 2184, 2185, 2187],
    mock: m18
  },
  {
    id: "m19",
    title: "Donut share",
    chartType: "donut",
    renderer: "DonutChart",
    sourceExport: "drsZoneDonutMock",
    status: "implemented",
    benchmarkQids: [2085, 2083, 2120],
    mock: m19
  },
  {
    id: "m20",
    title: "Cross-category composite",
    chartType: "composite",
    renderer: "CompositeCard",
    sourceExport: "compositeGrainingMock",
    status: "implemented",
    benchmarkQids: [2200, 2201, 2202, 2203, 2204, 2205, 2206, 2207, 2208],
    mock: m20
  },
  {
    id: "m21",
    title: "No-data refusal (muted card)",
    chartType: "",
    renderer: "NoDataCard",
    sourceExport: "noDataBrakeTempMock",
    status: "implemented",
    benchmarkQids: [1750, 1751, 1752, 1753, 1754, 1755, 1756, 1757, 1758],
    mock: m21
  },
  {
    id: "m22",
    title: "Pit-cycle event strip",
    chartType: "pit_event_strip",
    renderer: "PitEventStrip",
    sourceExport: "pitEventMock",
    status: "implemented",
    benchmarkQids: [2061, 2062, 2063, 2067],
    mock: m22
  },
  {
    id: "m23",
    title: "Track marker map (overtake locations on circuit outline)",
    chartType: "track_marker_map",
    renderer: "TrackMarkerMap (FOLLOW-UP)",
    sourceExport: null,
    status: "follow_up",
    benchmarkQids: [2081, 2082, 2084],
    mock: null
  }
];

/** Convenience accessors for the /mock route and adapter tests. */
export const IMPLEMENTED_FIXTURES: ReadonlyArray<InsightFixtureManifestEntry> =
  INSIGHT_FIXTURES.filter((entry) => entry.status === "implemented");

export const FOLLOW_UP_FIXTURES: ReadonlyArray<InsightFixtureManifestEntry> =
  INSIGHT_FIXTURES.filter((entry) => entry.status === "follow_up");

/** Lookup by id. Used by adapter tests + the qid → fixture mapping. */
export function findFixtureById(id: string): InsightFixtureManifestEntry | undefined {
  return INSIGHT_FIXTURES.find((entry) => entry.id === id);
}

/** Lookup by benchmark qid → fixture entry (or undefined if no mapping). */
export function findFixtureByQid(qid: number): InsightFixtureManifestEntry | undefined {
  return INSIGHT_FIXTURES.find((entry) => entry.benchmarkQids.includes(qid));
}

/** Effective in-scope count — readable by phases that branch on it. */
export const IN_SCOPE_MOCK_COUNT = IMPLEMENTED_FIXTURES.length;
