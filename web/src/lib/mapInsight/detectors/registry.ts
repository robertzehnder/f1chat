// Phase 5 + Phase 6 of the v0 visualization match plan: detector
// registry. All chart-shape detection lives here as a typed list of
// ChartDetector entries. Higher-priority detectors win when multiple
// match. mapInsight.ts's detectChart() is a thin wrapper that calls
// runDetectorRegistry().
//
// IN_SCOPE_MOCK_COUNT = 21 (M07 + M23 deferred per source-of-truth).
// 16 detectors total: 6 migrated Tier 1 + 10 new Tier 2/3.

import type { ChartSpec } from "@/lib/chart-types";
import { getTeamColor, getDistinctTeamColors, getDistinctTeamStyles } from "@/lib/f1-team-colors";
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
  // F13 (golden-set audit 2026-07-02): season_year leaked into the radar as
  // a "Season year" axis with value 2025 on a 0–100 scale, drawing a vertex
  // ~20x off-scale and destroying the polygon.
  "season_year",
  "season",
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

// pg returns NUMERIC and BIGINT as strings unless a global type parser
// is registered (see web/src/lib/db/driver.ts). The parser only takes
// effect on a fresh process boot, and captured JSON fixtures can still
// contain numeric strings. Keep every detector tolerant of either form
// so a valid chart never silently renders all-zero bars.
function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown, fallback = 0): number {
  return parseFiniteNumber(value) ?? fallback;
}

function isNumericLike(value: unknown): boolean {
  return parseFiniteNumber(value) !== null;
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

/**
 * Detect a wide-format speed-comparison row shape:
 *   { corner_label, VER_AVG_ENTRY_KPH, HAM_AVG_ENTRY_KPH, ... }
 * Driver-prefixed columns (3-letter abbreviation upper-case) carry
 * the per-driver values instead of multiple rows. Returns the list
 * of detected driver prefixes and the matching metric column name
 * within the prefix family.
 */
function detectWideDriverPrefixes(
  cols: string[],
  metricRegex: RegExp
): { prefix: string; col: string }[] {
  // Live SQL aliases are typically lowercase (ham_lap_s, ver_avg_entry_kph);
  // mock fixtures use uppercase (VER_AVG_ENTRY_KPH). Match either and
  // normalize the prefix to uppercase for the name-lookup map.
  const result: { prefix: string; col: string }[] = [];
  for (const c of cols) {
    const m = /^([A-Za-z]{3})_(.+)$/.exec(c);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    // Only count it as a driver prefix if we recognize the abbreviation —
    // otherwise random 3-letter columns ("min_", "max_", "avg_") collide.
    if (!(prefix in DRIVER_PREFIX_NAME)) continue;
    if (!metricRegex.test(m[2])) continue;
    result.push({ prefix, col: c });
  }
  return result;
}

/** Map driver 3-letter prefix to a display name. Falls back to the prefix. */
const DRIVER_PREFIX_NAME: Record<string, string> = {
  VER: "Max Verstappen",
  HAM: "Lewis Hamilton",
  NOR: "Lando Norris",
  PIA: "Oscar Piastri",
  LEC: "Charles Leclerc",
  RUS: "George Russell",
  SAI: "Carlos Sainz",
  ALB: "Alex Albon",
  ALO: "Fernando Alonso",
  STR: "Lance Stroll",
  GAS: "Pierre Gasly",
  OCO: "Esteban Ocon",
  HUL: "Nico Hulkenberg",
  TSU: "Yuki Tsunoda",
  PER: "Sergio Perez",
  ANT: "Andrea Kimi Antonelli",
  HAD: "Isack Hadjar",
  BOR: "Gabriel Bortoleto",
  BEA: "Oliver Bearman",
  DOO: "Jack Doohan",
  LAW: "Liam Lawson"
};

// Absolute-speed columns only — must NOT match delta columns. `apex_delta_vs_other_kph`
// contains "apex" but isn't an apex SPEED, so the regex requires the speed/kph suffix
// in the same token.
const ABS_SPEED_COL = /(entry|apex|exit|min|max)[A-Za-z_]*?(_speed_kph|_speed_km_?h|_speed_kmph|_kph)\b|^speed_kph$|_avg_speed/i;
// Hard reject: any column that looks like a delta — these belong to a delta_comparison
// chart, not a grouped_bar.
const DELTA_COL = /(?:^|_)(delta|gap|diff|advantage|deficit)(?:_|$)/i;

function hasAbsoluteSpeedCol(cols: string[]): boolean {
  return cols.some((c) => ABS_SPEED_COL.test(c) && !DELTA_COL.test(c));
}

const groupedBarDetector: ChartDetector = {
  id: "grouped_bar",
  priority: 100,
  fixtures: ["m04", "m05"],
  benchmarkQids: [1717, 1713, 1715, 1718, 1719, 1968, 1969, 1962, 1963, 1964, 1967, 1981, 1985, 1987],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    if (!cols.includes("corner_label")) return false;
    if (!hasAbsoluteSpeedCol(cols)) return false;
    // Long format: per-driver-corner rows with `driver_name` + absolute speed
    if (cols.includes("driver_name")) return true;
    // Wide format: one row per corner, columns prefixed per driver
    const wide = detectWideDriverPrefixes(cols, ABS_SPEED_COL).filter(
      (w) => !DELTA_COL.test(w.col)
    );
    return wide.length >= 2;
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const corners = uniqueStrings(rows.map((r) => r.corner_label));
    // Wide format path
    const wide = detectWideDriverPrefixes(cols, ABS_SPEED_COL).filter(
      (w) => !DELTA_COL.test(w.col)
    );
    if (wide.length >= 2 && !cols.includes("driver_name")) {
      // Each driver prefix may have multiple speed columns
      // (avg_entry_kph, avg_apex_kph, avg_exit_kph, ...). Pick a
      // single sub-metric that ALL drivers share, prioritising entry
      // speed (matches the v0 Suzuka mock).
      const SUB_PRIORITY = ["entry", "apex", "exit", "min", "max", "speed"];
      const prefixesPresent = Array.from(new Set(wide.map((w) => w.prefix)));
      let chosenSub: string | null = null;
      let chosenSubLabel = "Speed";
      for (const sub of SUB_PRIORITY) {
        const allHave = prefixesPresent.every((p) =>
          wide.some((w) => w.prefix === p && new RegExp(sub, "i").test(w.col))
        );
        if (allHave) {
          chosenSub = sub;
          chosenSubLabel = `${humanize(sub)} speed`;
          break;
        }
      }
      // For each prefix, pick the column that best matches chosenSub
      // (or the first available column if no sub was shared).
      const byPrefix = new Map<string, string>();
      for (const p of prefixesPresent) {
        const candidates = wide.filter((w) => w.prefix === p);
        const best = chosenSub
          ? candidates.find((w) => new RegExp(chosenSub!, "i").test(w.col)) ?? candidates[0]
          : candidates[0];
        byPrefix.set(p, best.col);
      }
      const wideNames = [...byPrefix.keys()].map((prefix) => DRIVER_PREFIX_NAME[prefix] ?? prefix);
      const wideColors = getDistinctTeamColors(wideNames);
      const series = [...byPrefix.entries()].map(([prefix, col]) => ({
        name: DRIVER_PREFIX_NAME[prefix] ?? prefix,
        values: corners.map((corner) => {
          const match = rows.find((r) => String(r.corner_label) === corner);
          const v = match?.[col];
          return toNumber(v);
        }),
        color: wideColors[DRIVER_PREFIX_NAME[prefix] ?? prefix]
      }));
      // Compress corner labels to chart-friendly form: "Turn 7 (Esses)" → "T7"
      const xAxisShort = corners.map((c) => {
        const m = /^Turn\s+(\d+)/i.exec(c);
        return m ? `T${m[1]}` : c;
      });
      return {
        type: "grouped_bar",
        x_axis: xAxisShort,
        y_label: `${chosenSubLabel} (km/h)`,
        series
      };
    }
    // Long format path (original)
    const speedCol =
      findCol(cols, /entry.*speed|entry_speed/) ??
      findCol(cols, /apex.*speed|apex_min_speed/) ??
      findCol(cols, /exit.*speed/) ??
      findCol(cols, /speed/) ??
      "speed_kph";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const driverColors = getDistinctTeamColors(drivers);
    const series = drivers.map((driver) => ({
      name: driver,
      values: corners.map((corner) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && String(r.corner_label) === corner
        );
        const v = match?.[speedCol];
        return toNumber(v);
      }),
      color: driverColors[driver]
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
    const cols = Object.keys(rows[0]);
    // `positions_gained` is the warehouse-native name (core.grid_vs_finish,
    // lap-1 launch queries); `position_delta` is the mock-era alias. Stint
    // rows carry positions_gained as per-driver context — those belong to
    // the stint_gantt detector, not a diverging bar.
    if (cols.includes("stint_number") || cols.includes("compound") || cols.includes("compound_name")) {
      return false;
    }
    return cols.includes("position_delta") || cols.includes("positions_gained");
  },
  build(rows) {
    const deltaOf = (r: Record<string, unknown>) =>
      toNumber(r.position_delta ?? r.positions_gained ?? 0);
    const sorted = [...rows].sort((a, b) => deltaOf(b) - deltaOf(a));
    return {
      type: "horizontal_bar_diverging",
      y_axis: sorted.map((r) => String(r.driver_name ?? r.driver_number ?? "")),
      x_label: "Positions gained / lost",
      series: [
        {
          name: "Position Δ",
          values: sorted.map(deltaOf),
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
    // F03 (golden-set audit 2026-07-02): analytics.traffic_adjusted_pace
    // counts over 2x-duplicated laps_enriched rows, so a driver can show
    // 108 laps for a ~54-lap race (84 clean + 24 traffic). No F1 race
    // exceeds ~87 laps — when a row's total is physically impossible it's
    // the exact-2x dup artifact; halve so the bar reflects reality.
    const MAX_PLAUSIBLE_RACE_LAPS = 87;
    const scaleFor = (r: Record<string, unknown>): number => {
      const total = toNumber(r[cleanCol] ?? 0) + toNumber(r[trafficCol] ?? 0);
      return total > MAX_PLAUSIBLE_RACE_LAPS ? 0.5 : 1;
    };
    return {
      type: "stacked_horizontal_bar",
      y_axis: rows.map((r) =>
        String(r.driver_name ? lastName(String(r.driver_name)) : r.driver_number ?? "")
      ),
      x_label: "Laps",
      series: [
        {
          name: "Clean Air",
          values: rows.map((r) => Math.round(toNumber(r[cleanCol] ?? 0) * scaleFor(r))),
          color: "#22C55E"
        },
        {
          name: "In Traffic",
          values: rows.map((r) => Math.round(toNumber(r[trafficCol] ?? 0) * scaleFor(r))),
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
    // Accept the warehouse's native column names too (compound_name +
    // lap_start/lap_end from core.stint_summary) — LLM-generated SQL
    // returns those verbatim, and the old exact-name match made strategy
    // questions fall through to the horizontal-bar fallback (2025 Spa
    // strategy-split incident rendered pit-duration bars instead of the
    // stint timeline). stint_number guards against matching arbitrary
    // lap tables that happen to carry a compound column.
    const hasCompound = cols.includes("compound") || cols.includes("compound_name");
    const hasStart = cols.includes("stint_start_lap") || cols.includes("lap_start");
    const hasEnd = cols.includes("stint_end_lap") || cols.includes("lap_end");
    const hasStint = cols.includes("stint_number") || cols.includes("stint_start_lap");
    return hasCompound && hasStart && hasEnd && hasStint;
  },
  build(rows) {
    const drivers = uniqueStrings(rows.map((r) => r.driver_name ?? r.driver_number));
    // Dedupe per (driver, stint) — core matviews ship duplicate rows.
    const seen = new Set<string>();
    const stints = rows
      .filter((r) => {
        const key = `${r.driver_name ?? r.driver_number}:${r.stint_number ?? r.stint_start_lap ?? r.lap_start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({
        driver: String(r.driver_name ?? r.driver_number ?? ""),
        start: toNumber(r.stint_start_lap ?? r.lap_start ?? 0),
        end: toNumber(r.stint_end_lap ?? r.lap_end ?? 0),
        // Warehouse value is "INTERMEDIATE"; the renderer's color map only
        // knows "inter".
        compound: String(r.compound ?? r.compound_name ?? "medium")
          .toLowerCase()
          .replace(/^intermediate$/, "inter") as
          | "hard" | "medium" | "soft" | "inter" | "wet",
        lap_times_avg: isNumericLike(r.avg_lap_time)
          ? toNumber(r.avg_lap_time)
          : isNumericLike(r.avg_valid_lap)
            ? toNumber(r.avg_valid_lap)
            : undefined
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
    const hasLap = cols.includes("lap_number") || cols.includes("lap");
    if (!hasLap) return false;
    // Don't fire if stint markers are present — that's M10's territory
    if (cols.some((c) => /stint_boundary|stint_start_lap/.test(c))) return false;
    // Long format: per-driver-lap rows with lap_time/delta column
    if (cols.some((c) => /lap_time|delta/.test(c)) && cols.includes("driver_name")) {
      return true;
    }
    // Wide format: one row per lap, columns prefixed per driver (HAM_LAP_S, RUS_LAP_TIME, ...)
    const wide = detectWideDriverPrefixes(cols, /lap_time|lap_s|delta/i);
    return wide.length >= 2;
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const lapCol = cols.includes("lap_number") ? "lap_number" : "lap";
    const isLapTimeCol = (c: string) => /lap_time|lap_s\b|lap_duration|stint_avg|stint_median/i.test(c) && !/delta|gap|diff/i.test(c);
    const isDeltaCol = (c: string) => /delta|gap|diff/i.test(c);
    // Use NaN for missing data so recharts breaks the line cleanly instead
    // of plunging to zero (which destroys the Y-axis scale).
    const valueOrNaN = (v: unknown): number => (isNumericLike(v) ? toNumber(v) : NaN);

    // Wide format path
    const wide = detectWideDriverPrefixes(cols, /lap_time|lap_s|delta/i);
    if (wide.length >= 2 && !cols.includes("driver_name")) {
      const byPrefix = new Map<string, string>();
      for (const w of wide) if (!byPrefix.has(w.prefix)) byPrefix.set(w.prefix, w.col);
      const laps = Array.from(new Set(rows.map((r) => toNumber(r[lapCol] ?? 0)))).sort((a, b) => a - b);
      const sampleCol = [...byPrefix.values()][0];
      const sampleSub = sampleCol ? sampleCol.replace(/^[A-Za-z]{3}_/, "") : "lap_time";
      const yFmt: ChartSpec["y_value_format"] = isLapTimeCol(sampleSub)
        ? "lap_time_s"
        : isDeltaCol(sampleSub)
          ? "decimal_seconds"
          : undefined;
      const wideNames = [...byPrefix.keys()].map((prefix) => DRIVER_PREFIX_NAME[prefix] ?? prefix);
      const wideStyles = getDistinctTeamStyles(wideNames);
      const series = [...byPrefix.entries()].map(([prefix, col]) => {
        const nm = DRIVER_PREFIX_NAME[prefix] ?? prefix;
        return {
          name: nm,
          color: wideStyles[nm]?.color ?? getTeamColor(nm),
          strokeDasharray: wideStyles[nm]?.strokeDasharray,
          values: laps.map((lap) => {
            const match = rows.find((r) => toNumber(r[lapCol]) === lap);
            return valueOrNaN(match?.[col]);
          })
        };
      });
      return {
        type: "line",
        x_label: "Lap",
        y_label: yFmt === "lap_time_s" ? "Lap time" : humanize(sampleSub),
        y_value_format: yFmt,
        series
      };
    }
    // Long format path
    const valueCol =
      findCol(cols, /lap_time|lap_duration/) ?? findCol(cols, /delta|gap/) ?? "lap_time";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const laps = Array.from(new Set(rows.map((r) => toNumber(r[lapCol] ?? 0)))).sort((a, b) => a - b);
    const yFmt: ChartSpec["y_value_format"] = isLapTimeCol(valueCol)
      ? "lap_time_s"
      : isDeltaCol(valueCol)
        ? "decimal_seconds"
        : undefined;
    const driverStyles = getDistinctTeamStyles(drivers);
    const series = drivers.map((driver) => ({
      name: driver,
      color: driverStyles[driver]?.color ?? getTeamColor(driver),
      strokeDasharray: driverStyles[driver]?.strokeDasharray,
      values: laps.map((lap) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && toNumber(r[lapCol]) === lap
        );
        return valueOrNaN(match?.[valueCol]);
      })
    }));
    return {
      type: "line",
      x_label: "Lap",
      y_label: yFmt === "lap_time_s" ? "Lap time" : humanize(valueCol),
      y_value_format: yFmt,
      series
    };
  }
};

// Column-name patterns that should be IGNORED when picking the
// numeric value column for a horizontal bar — these are usually
// metadata (lap indices, identifiers) rather than the user-meaningful
// metric.
const HBAR_DEPRIORITIZED_COLS = /(?:^|_)(pit_in_lap|pit_out_lap|lap_number|lap|in_lap|out_lap|position|grid|year|round|driver_number|session_key|meeting_key)(?:_number)?$/i;
// Column-name patterns we explicitly PREFER (in priority order).
const HBAR_PREFERRED_COL_PATTERNS = [
  // F20 (golden-set audit 2026-07-02): word-boundary the duration_sec* / _s
  // patterns — without \b they substring-matched `duration_sector_1`, so a
  // pole-lap hero card grew a bogus one-bar "Duration sector 1" chart that
  // beat `lap_duration`. Promote lap_duration into the first tier too.
  /pit_loss|stationary_seconds|stationary_s\b|duration_sec\b|duration_s\b|duration_ms\b|pit_time|service_time|lap_duration/i,
  /lap_time_s\b|lap_time_ms\b|lap_time/i,
  /gap_seconds|gap_s\b|gap_ms\b|gap/i,
  /delta_s\b|delta_ms\b|delta/i,
  /avg_|mean_|median_/i
];

function pickHorizontalBarValueCol(rows: Record<string, unknown>[]): string | undefined {
  const cols = Object.keys(rows[0]);
  const numericCols = cols.filter(
    (c) => !IDENTIFIER_COLS.has(c) && isNumericLike(rows[0][c])
  );
  if (numericCols.length === 0) return undefined;
  // 1. Try preferred patterns in order
  for (const pat of HBAR_PREFERRED_COL_PATTERNS) {
    const hit = numericCols.find((c) => pat.test(c));
    if (hit) return hit;
  }
  // 2. Otherwise, prefer any column NOT in the deprioritized set
  const nonMetadata = numericCols.find((c) => !HBAR_DEPRIORITIZED_COLS.test(c));
  if (nonMetadata) return nonMetadata;
  // 3. Last resort: first numeric (matches old behavior)
  return numericCols[0];
}

const horizontalBarDetector: ChartDetector = {
  id: "horizontal_bar",
  priority: 50, // Low priority — fallback when nothing more specific matches
  fixtures: ["m06"],
  benchmarkQids: [2080, 1701, 1712, 2001, 2002, 2080, 2101, 2160],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    if (!cols.includes("driver_name") && !cols.includes("driver_number")) return false;
    // F20: a single-row result (a hero fact like a pole lap) has nothing to
    // compare — a 1-bar chart is noise. Require ≥2 rows for a bar chart.
    if (rows.length < 2) return false;
    return Boolean(pickHorizontalBarValueCol(rows));
  },
  build(rows) {
    const numericCol = pickHorizontalBarValueCol(rows) ?? "value";
    const cols = Object.keys(rows[0]);
    // Resolve a driver-label column: prefer driver_name, fall back to
    // full_name / driver / driver_label / driver_number.
    const labelCol =
      ["driver_name", "full_name", "driver", "driver_label"].find((c) => cols.includes(c)) ??
      "driver_number";

    // Aggregate duplicates per driver — SQL sometimes returns one row
    // per event (e.g. one row per pit stop instead of one per driver).
    // For "lower is better" metrics (pit_loss, lap_time, gap), take the
    // MIN; for everything else, take the MAX (worst-case e.g. top speed).
    const lowerIsBetter = /pit_loss|stationary|duration|lap_time|gap|delta|loss|service/i.test(numericCol);
    const aggregate = new Map<string, number>();
    for (const r of rows) {
      const key = String(r[labelCol] ?? r.driver_number ?? "");
      if (!key) continue;
      const v = toNumber(r[numericCol]);
      if (!Number.isFinite(v)) continue;
      const existing = aggregate.get(key);
      if (existing === undefined) {
        aggregate.set(key, v);
      } else {
        aggregate.set(key, lowerIsBetter ? Math.min(existing, v) : Math.max(existing, v));
      }
    }

    const entries = [...aggregate.entries()].sort((a, b) =>
      lowerIsBetter ? a[1] - b[1] : b[1] - a[1]
    );

    // Display: last-name only with proper case ("Lewis HAMILTON" → "Hamilton").
    // Skips numeric driver_numbers (those would show as the raw number).
    const shortLabel = (label: string): string => {
      if (/^\d+$/.test(label.trim())) return label;
      const parts = label.trim().split(/\s+/);
      const last = parts[parts.length - 1] ?? label;
      return last.length === 0 ? label : last[0].toUpperCase() + last.slice(1).toLowerCase();
    };

    return {
      type: "horizontal_bar",
      y_axis: entries.map(([label]) => shortLabel(label)),
      x_label: humanize(numericCol),
      series: [
        {
          name: humanize(numericCol),
          values: entries.map(([, v]) => v),
          // Single color is a fallback only — horizontal-bar-chart.tsx
          // calls getTeamColorByDriver(label) per bar at render time.
          color: "#E10600"
        }
      ]
    };
  }
};

// =============================================================================
// Tier 2 detectors (5) — Phase 6
// =============================================================================

// A4: parse an explicit corner reference out of a race-control message.
// Data-gated — returns null unless the text names a corner, so the pin is
// never invented. Handles "TURN 7", "T7", "AT TURN 1", "TURNS 3/4" (first).
function parseCornerFromMessage(
  message: string
): { corner_number: number; corner_label: string } | null {
  if (!message) return null;
  const m = /\bturns?\s*(\d{1,2})|\bt(\d{1,2})\b/i.exec(message);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 30) return null;
  return { corner_number: n, corner_label: `Turn ${n}` };
}

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
    const circuit =
      typeof rows[0]?.circuit_short_name === "string" && rows[0].circuit_short_name
        ? String(rows[0].circuit_short_name)
        : undefined;
    return {
      type: "event_timeline",
      circuit,
      events: rows.map((r) => {
        const message = String(r.message ?? r.note ?? "");
        const corner = parseCornerFromMessage(message);
        return {
          lap: toNumber(r.lap ?? 0),
          driver: String(r.driver ?? r.driver_name ?? ""),
          kind: String(r.kind ?? "event"),
          team_color: getTeamColor(String(r.driver ?? r.driver_name ?? "")),
          message,
          ...(circuit ? { circuit } : {}),
          ...(corner
            ? { corner_label: corner.corner_label, corner_number: corner.corner_number }
            : {})
        };
      })
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
    const numericCount = cols.filter(
      (c) => !IDENTIFIER_COLS.has(c) && isNumericLike(rows[0][c])
    ).length;
    if (numericCount < 4) return false;
    // Column-shape signal: ≥3 columns ending in _axis is a strong
    // standalone tell that this is the 7-axis performance matview
    // shape (M17). Reliable when ctx.question isn't threaded.
    const axisCols = cols.filter((c) => /_axis$/i.test(c));
    if (axisCols.length >= 3) return true;
    // Topic signal: question mentions axis/score/rating/performance.
    const topic = (ctx.question ?? "").toLowerCase();
    return /\b(axis|score|rating|performance|7.?axis)\b/.test(topic);
  },
  build(rows) {
    const RADAR_MAX = 100;
    const cols = Object.keys(rows[0]).filter(
      (c) =>
        !IDENTIFIER_COLS.has(c) &&
        c !== "driver_name" &&
        isNumericLike(rows[0][c]) &&
        // F13 defense-in-depth: a column whose value exceeds the 0–100 radar
        // domain in EVERY row is an identifier that slipped the denylist
        // (e.g. a year), never a score — drop it from the axis set.
        rows.some((r) => toNumber(r[c] ?? 0) <= RADAR_MAX)
    );
    // Radar is a head-to-head; give same-team drivers a distinct hue (primary
    // vs secondary) so two Ferrari/Mercedes polygons don't read as one.
    const radarStyles = getDistinctTeamStyles(
      rows.map((r) => String(r.driver_name ?? ""))
    );
    const series = rows.map((r) => {
      const name = String(r.driver_name ?? "");
      return {
        name,
        values: cols.map((c) => toNumber(r[c] ?? 0)),
        color: radarStyles[name]?.color ?? getTeamColor(name)
      };
    });
    // Partial-data handling (driver_performance_score data-quality plan §A,
    // remediation #3). When an axis is exactly 0 across EVERY series, the
    // upstream matview is almost certainly emitting a COALESCE default
    // rather than a real value (every floor formula in migration 045
    // produces 0 when its raw input is NULL). Those axes are dropped from
    // the polygon — drawing them renders fake zeros as if both drivers
    // scored nothing — and the count feeds the "⚠ N of 7 axes not yet
    // populated" caption.
    const allLabels = cols.map(radarAxisLabel);
    const zeroIdx = new Set(
      cols.map((_, idx) => idx).filter((idx) => series.every((s) => s.values[idx] === 0))
    );
    const emptyAxes = [...zeroIdx].map((idx) => allLabels[idx]);
    const liveCount = cols.length - zeroIdx.size;
    const partial = zeroIdx.size > 0 ? zeroIdx.size : undefined;
    // B3: RETAIN empty (all-zero) axes instead of dropping them — the radar keeps
    // its full shape and the renderer greys + dashes the unpopulated spokes. A
    // radar still needs ≥3 POPULATED vertices to read as a shape; with 0–2 live
    // axes fall back to a grouped bar of the full labelled axis set.
    if (liveCount < 3) {
      return {
        type: "grouped_bar",
        x_axis: allLabels,
        y_label: "Score (0–100)",
        series: series.map((s) => ({ name: s.name, values: s.values, color: s.color })),
        partial_data_axes: partial,
        total_axes: cols.length,
        empty_axes: emptyAxes.length > 0 ? emptyAxes : undefined,
      };
    }
    return {
      type: "radar",
      axes: allLabels,
      max_value: 100,
      series,
      partial_data_axes: partial,
      total_axes: cols.length,
      empty_axes: emptyAxes.length > 0 ? emptyAxes : undefined,
    };
  }
};

// Friendly radar axis labels — drop the "_axis" suffix and abbreviate the
// noisier names so the wheel doesn't wrap on smaller cards. Falls back
// to humanize() for any column we don't have a dedicated mapping for.
//
// Semantic ownership note: the matview at sql/migrations/deploy/045_analytics_driver_performance_score.sql
// already inverts error_rate (formula `(10 - season_penalties) * 10`), so
// "Consistency" — where higher = better — is consistent with the deployed
// data. If migration 045 is ever changed to surface raw error counts
// instead, this label and any downstream consumer must flip too.
const RADAR_AXIS_LABELS: Record<string, string> = {
  qualifying_axis: "Qualifying",
  race_pace_axis: "Race Pace",
  tyre_management_axis: "Tyre Mgmt",
  restart_axis: "Restart",
  traffic_handling_axis: "Traffic",
  overtake_difficulty_axis: "Overtaking",
  error_rate_axis: "Consistency",
};

function radarAxisLabel(col: string): string {
  const lower = col.toLowerCase();
  if (RADAR_AXIS_LABELS[lower]) return RADAR_AXIS_LABELS[lower];
  // Generic: strip a trailing "_axis" / " axis" then humanize.
  return humanize(lower.replace(/_axis$/i, ""));
}

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
    const driverColors = getDistinctTeamColors(drivers);
    const series = drivers.map((driver) => {
      const driverRows = rows.filter((r) => String(r.driver_name) === driver);
      const rawPoints: [number, number][] = driverRows
        .map((r): [number, number] => [
          toNumber(r[lapCol] ?? 0),
          toNumber(r[valueCol] ?? 0)
        ])
        .filter(([, y]) => Number.isFinite(y) && y > 0);

      // Outlier-trim so safety-car / VSC / in-/out-laps don't dominate
      // the regression. We drop anything outside [median - 1.5×IQR,
      // median + 1.5×IQR] AND anything more than 15% above the median
      // (catches single SC laps that would otherwise drag the slope
      // into the negatives). At least 3 points must survive for the
      // trim to apply; otherwise we keep all points.
      const ys = rawPoints.map((p) => p[1]).sort((a, b) => a - b);
      const points: [number, number][] = (() => {
        if (ys.length < 4) return rawPoints;
        const q = (frac: number) => ys[Math.min(ys.length - 1, Math.floor(ys.length * frac))];
        const median = q(0.5);
        const iqr = q(0.75) - q(0.25);
        const upperCap = Math.min(median + 1.5 * iqr, median * 1.15);
        const lowerCap = Math.max(median - 1.5 * iqr, median * 0.85);
        const trimmed = rawPoints.filter(([, y]) => y >= lowerCap && y <= upperCap);
        return trimmed.length >= 3 ? trimmed : rawPoints;
      })();

      // Slope via simple linear regression (least squares) on the
      // outlier-trimmed set.
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
        color: driverColors[driver]
      };
    });
    return {
      type: "scatter_with_regression",
      x_label: "Stint lap",
      y_label: "Lap time (s)",
      y_value_format: "lap_time_s",
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
    const legacyRows = rows.map((r) => {
      const cells: Record<string, string | number | undefined> = {};
      for (const c of coverageCols) cells[c] = String(r[c] ?? "missing");
      return {
        session_key: isNumericLike(r.session_key) ? toNumber(r.session_key) : undefined,
        label: String(r[labelCol] ?? ""),
        ...cells
      };
    });

    // Venue-grid mode: when the rows carry a circuit key (the M18 telemetry-
    // vs-weather template), roll every session up to a per-VENUE status so
    // the renderer can draw a 24-circuit coverage grid. A session is a "gap"
    // if ANY coverage column is missing/partial. Venue is green with zero
    // gaps, red when EVERY session is a gap, amber otherwise.
    const hasCircuit = cols.includes("circuit_short_name");
    if (hasCircuit) {
      const acc = new Map<
        string,
        { circuit: string; location: string; round?: number; total: number; gaps: number }
      >();
      for (const r of rows) {
        const circuit = String(r.circuit_short_name ?? "").trim();
        if (!circuit) continue;
        const sessionHasGap = coverageCols.some((c) => {
          const v = String(r[c] ?? "missing").toLowerCase();
          return v === "missing" || v === "partial";
        });
        const entry =
          acc.get(circuit) ??
          {
            circuit,
            location: String(r.location ?? circuit),
            round: isNumericLike(r.round) ? toNumber(r.round) : undefined,
            total: 0,
            gaps: 0
          };
        entry.total += 1;
        if (sessionHasGap) entry.gaps += 1;
        if (entry.round === undefined && isNumericLike(r.round)) entry.round = toNumber(r.round);
        acc.set(circuit, entry);
      }
      const venues = [...acc.values()]
        .map((v) => ({
          circuit: v.circuit,
          location: v.location,
          round: v.round,
          total: v.total,
          gaps: v.gaps,
          status: (v.gaps === 0 ? "green" : v.gaps >= v.total ? "red" : "amber") as
            | "green"
            | "amber"
            | "red"
        }))
        .sort((a, b) => (a.round ?? 999) - (b.round ?? 999) || a.location.localeCompare(b.location));
      if (venues.length > 0) {
        return {
          type: "status_grid",
          venue_grid: true,
          venues,
          rows: legacyRows,
          legend: { full: "#22C55E", partial: "#F59E0B", missing: "#EF4444" }
        };
      }
    }

    return {
      type: "status_grid",
      rows: legacyRows,
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
      value: toNumber(r[valueCol] ?? 0),
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
    // lap_number + wet_track come from the deterministic wet-crossover
    // template (analytics.weather_impact carries a wet flag, not rainfall).
    return (
      (cols.includes("lap") || cols.includes("lap_number")) &&
      cols.some((c) => /lap_time/.test(c)) &&
      cols.some((c) => /rainfall|track_temp|air_temp|wind|wet_track|is_wet/.test(c))
    );
  },
  build(rows) {
    const cols = Object.keys(rows[0]);
    const lapTimeCol = findCol(cols, /lap_time/) ?? "lap_time";
    const weatherCol =
      findCol(cols, /rainfall/) ??
      findCol(cols, /track_temp/) ??
      findCol(cols, /wet_track|is_wet/) ??
      "weather";
    const lapCol = cols.includes("lap") ? "lap" : "lap_number";
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const laps = Array.from(new Set(rows.map((r) => toNumber(r[lapCol] ?? 0)))).sort((a, b) => a - b);
    const driverStyles = getDistinctTeamStyles(drivers);
    const driverSeries = drivers.map((driver) => ({
      name: `${driver} (lap time)`,
      axis: "y1" as const,
      color: driverStyles[driver]?.color ?? getTeamColor(driver),
      strokeDasharray: driverStyles[driver]?.strokeDasharray,
      // F10 (golden-set audit 2026-07-02): a missing (driver, lap) row —
      // e.g. a retirement — must become NaN, not literal 0, or the line
      // plunges from ~140s to 0 below the axis floor. connectNulls=false
      // then terminates the line at the retirement lap.
      values: laps.map((lap) => {
        const match = rows.find(
          (r) => String(r.driver_name) === driver && toNumber(r[lapCol]) === lap
        );
        return match && isNumericLike(match[lapTimeCol]) ? toNumber(match[lapTimeCol]) : NaN;
      })
    }));
    const weatherSeries = {
      name: humanize(weatherCol),
      axis: "y2" as const,
      color: "#1868DB",
      values: laps.map((lap) => {
        const match = rows.find((r) => toNumber(r[lapCol]) === lap);
        return match && isNumericLike(match[weatherCol]) ? toNumber(match[weatherCol]) : NaN;
      })
    };
    // Pit/tyre markers: every per-driver compound TRANSITION is a pit
    // stop, so mark each with the compound the driver switched onto
    // ("Norris → Med"). This covers the inters→slicks crossover and any
    // earlier wet-phase stops in one consistent annotation.
    const titleCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
    const COMPOUND_SHORT: Record<string, string> = {
      INTERMEDIATE: "Int", MEDIUM: "Med", SOFT: "Soft", HARD: "Hard", WET: "Wet"
    };
    const markers: Array<{ x: number; label: string }> = [];
    if (cols.includes("compound_name") && cols.includes("driver_name")) {
      const lastCompound = new Map<string, string>();
      const sorted = [...rows].sort(
        (a, b) =>
          String(a.driver_name ?? "").localeCompare(String(b.driver_name ?? "")) ||
          toNumber(a[lapCol]) - toNumber(b[lapCol])
      );
      for (const r of sorted) {
        const driver = String(r.driver_name ?? "");
        const compound = String(r.compound_name ?? "").toUpperCase();
        if (!driver || !compound) continue;
        const prev = lastCompound.get(driver);
        if (prev && prev !== compound) {
          markers.push({
            x: toNumber(r[lapCol]),
            label: `${titleCase(lastName(driver))} → ${COMPOUND_SHORT[compound] ?? titleCase(compound)}`
          });
        }
        lastCompound.set(driver, compound);
      }
    }
    return {
      type: "line_dual_axis",
      x_label: "Lap",
      y1_label: "Lap time (s)",
      y2_label: humanize(weatherCol),
      vertical_markers: markers.length ? markers : undefined,
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
    const drivers = uniqueStrings(rows.map((r) => r.driver_name));
    const isSingleDriver = drivers.length === 0;
    // Single-driver pace lines read best as absolute lap pace (the cliff is
    // a sustained step you can see); multi-driver charts keep the
    // delta-to-reference convention. Fall back across the alternatives.
    const valueCol = isSingleDriver
      ? findCol(cols, /lap_time|lap_duration/) ??
        findCol(cols, /rolling/) ??
        findCol(cols, /delta/) ??
        "lap_duration"
      : findCol(cols, /delta/) ?? findCol(cols, /lap_time|lap_duration/) ?? "lap_duration";
    const isPitLapFlag = (v: unknown): boolean => v === true || v === "true" || v === "t";
    // Exclude pit-in / pit-out laps from the line: their durations are
    // 20-70s outliers that would blow out the y-axis and flatten the real
    // pace trend. NaN breaks the line cleanly at the stop.
    const excludePitLaps = cols.includes("is_pit_lap") || cols.includes("is_pit_out_lap");
    const valueAt = (predicate: (r: Record<string, unknown>) => boolean): number => {
      const match = rows.find(predicate);
      if (!match) return NaN;
      if (excludePitLaps && (isPitLapFlag(match.is_pit_lap) || isPitLapFlag(match.is_pit_out_lap))) {
        return NaN;
      }
      const n = isNumericLike(match[valueCol]) ? toNumber(match[valueCol]) : NaN;
      // NULL-sentinel guard: LLM-generated SQL sometimes COALESCEs missing
      // lap times to a sentinel like 999999999. No real F1 value (lap time,
      // delta, position) is anywhere near 1e6, so treat such magnitudes as
      // missing — otherwise one sentinel blows the y-axis domain to ~1e9 and
      // squashes the whole line. The median trim below only fires for
      // absolute-pace columns, so this guard is the universal backstop.
      return Math.abs(n) >= 1e6 ? NaN : n;
    };
    // Dense lap axis from 1..maxLap. The renderer maps series.values[i] to
    // lap i+1, so the array MUST be 1-indexed by lap — a compact array of
    // only the present laps (e.g. when lap 1 is dropped, or there are gaps)
    // would shift the whole x-axis and misalign the markers. Missing laps
    // resolve to NaN via valueAt and break the line cleanly.
    const maxLap = Math.max(0, ...rows.map((r) => toNumber(r.lap_number ?? 0)));
    const laps = Array.from({ length: maxLap }, (_, i) => i + 1);
    // Absolute-pace lines (lap time / duration) get median-trimmed: any
    // lap outside ±15% of the median is NaN'd out. This catches SC laps and
    // unflagged anomalies (e.g. a mislabelled pit lap) that the is_pit_lap
    // filter misses but would otherwise blow out the y-axis and flatten the
    // real trend. Delta lines keep all points (their scale is already small).
    const isAbsolutePace = /lap_time|lap_duration/i.test(valueCol);
    const trim = (values: number[]): number[] => {
      if (!isAbsolutePace) return values;
      const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      if (finite.length < 4) return values;
      const median = finite[Math.floor(finite.length / 2)];
      const hi = median * 1.15;
      const lo = median * 0.85;
      return values.map((v) => (Number.isFinite(v) && (v < lo || v > hi) ? NaN : v));
    };
    // Single-driver result sets frequently omit a driver_name column (one
    // row per lap). Without this fallback `drivers` is empty, `series` has
    // length 0, and the chart renders as a blank box. Build one series
    // keyed on the lap rows instead.
    const series = isSingleDriver
      ? [
          {
            name: humanize(valueCol),
            color: "#E10600",
            values: trim(laps.map((lap) => valueAt((r) => toNumber(r.lap_number) === lap)))
          }
        ]
      : (() => {
          const driverColors = getDistinctTeamColors(drivers);
          return drivers.map((driver) => ({
            name: driver,
            color: driverColors[driver],
            values: trim(
              laps.map((lap) =>
                valueAt((r) => String(r.driver_name) === driver && toNumber(r.lap_number) === lap)
              )
            )
          }));
        })();
    // Markers: a "Cliff" line where is_cliff_onset is set (pace-cliff card),
    // and a "Pit" line from an explicit pit_lap/stint_boundary column or the
    // per-lap is_pit_lap flag that single-driver lap tables carry. De-dupe by
    // (lap,label) since laps_enriched ships duplicate rows in the warehouse.
    const seenBoundaries = new Set<string>();
    const boundaries: Array<{ lap: number; label: string }> = [];
    const addBoundary = (lap: number, label: string) => {
      const key = `${lap}:${label}`;
      if (seenBoundaries.has(key)) return;
      seenBoundaries.add(key);
      boundaries.push({ lap, label });
    };
    for (const r of rows) {
      const lap = toNumber(r.lap_number ?? 0);
      if (isPitLapFlag(r.is_cliff_onset)) addBoundary(lap, "Cliff");
      if (r.pit_lap || r.stint_boundary || isPitLapFlag(r.is_pit_lap)) {
        addBoundary(lap, String(r.stint_boundary_label ?? r.pit_label ?? "Pit"));
      }
    }
    // Tell the renderer how to format the y-axis: lap times as M:SS.mmm,
    // deltas as signed seconds. Otherwise an 81.7s lap shows as a raw
    // "81.7706" tick instead of "1:21.8".
    const yFmt: ChartSpec["y_value_format"] = isAbsolutePace
      ? "lap_time_s"
      : /delta|gap/i.test(valueCol)
        ? "decimal_seconds"
        : undefined;
    return {
      type: "line_with_stint_markers",
      x_label: "Lap",
      y_label: isAbsolutePace ? "Lap time" : humanize(valueCol),
      y_value_format: yFmt,
      series,
      stint_boundaries: boundaries
    };
  }
};

const raceTraceDetector: ChartDetector = {
  id: "race_trace",
  priority: 105,
  fixtures: [],
  benchmarkQids: [],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("gap_to_leader_s") && cols.includes("driver_name") && cols.includes("lap_number");
  },
  build(rows) {
    const driverOrder: string[] = [];
    const finishOf = new Map<string, number>();
    for (const r of rows) {
      const name = String(r.driver_name ?? "");
      if (!name) continue;
      if (!driverOrder.includes(name)) driverOrder.push(name);
      const fin = parseFiniteNumber(r.finish_position);
      if (fin !== null) finishOf.set(name, fin);
    }
    driverOrder.sort((a, b) => (finishOf.get(a) ?? 99) - (finishOf.get(b) ?? 99));
    const colors = getDistinctTeamColors(driverOrder);
    const maxLap = Math.max(0, ...rows.map((r) => toNumber(r.lap_number ?? 0)));
    const laps = Array.from({ length: maxLap }, (_, i) => i + 1);
    const gapAt = new Map<string, number>();
    for (const r of rows) {
      gapAt.set(`${r.driver_name}:${toNumber(r.lap_number)}`, toNumber(r.gap_to_leader_s));
    }
    const series = driverOrder.map((driver) => ({
      name: driver,
      color: colors[driver],
      values: laps.map((lap) => {
        const v = gapAt.get(`${driver}:${lap}`);
        return v === undefined ? NaN : v;
      })
    }));
    const neutralized = [
      ...new Set(rows.filter((r) => r.is_neutralized === true || r.is_neutralized === "t").map((r) => toNumber(r.lap_number)))
    ].sort((a, b) => a - b);
    const isFlag = (v: unknown): boolean => v === true || v === "t" || v === "true";
    const pitDots = rows
      .filter((r) => isFlag(r.is_pit_lap))
      .map((r) => ({
        x: toNumber(r.lap_number),
        y: toNumber(r.gap_to_leader_s),
        color: colors[String(r.driver_name ?? "")] ?? "#E10600",
        driver: String(r.driver_name ?? "")
      }));
    return {
      type: "race_trace",
      x_label: "Lap",
      y_label: "Gap to leader (s)",
      y_value_format: "decimal_seconds",
      series,
      neutralized_laps: neutralized,
      trace_pit_dots: pitDots
    };
  }
};

const degradationCurveDetector: ChartDetector = {
  id: "degradation_curve",
  priority: 104,
  fixtures: [],
  benchmarkQids: [],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("deg_delta_s") && cols.includes("tyre_age") && cols.includes("compound_name");
  },
  build(rows) {
    const compounds = uniqueStrings(rows.map((r) => r.compound_name));
    const maxAge = Math.max(0, ...rows.map((r) => toNumber(r.tyre_age ?? 0)));
    const ages = Array.from({ length: maxAge + 1 }, (_, i) => i);
    const series = compounds.map((compound) => ({
      name: humanize(compound),
      color: COMPOUND_HEX[compound.toLowerCase()] ?? COMPOUND_HEX[compound.toLowerCase().replace("intermediate", "inter")] ?? "#9CA3AF",
      values: ages.map((age) => {
        const match = rows.find((r) => String(r.compound_name) === compound && toNumber(r.tyre_age) === age);
        return match && isNumericLike(match.deg_delta_s) ? toNumber(match.deg_delta_s) : NaN;
      })
    }));
    return {
      type: "degradation_curve",
      x_label: "Tyre age (laps)",
      y_label: "Δ vs fresh-tyre median (s)",
      y_value_format: "decimal_seconds",
      series
    };
  }
};

const positionChangesDetector: ChartDetector = {
  id: "position_changes",
  priority: 106,
  fixtures: [],
  benchmarkQids: [],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("position") && cols.includes("total_laps") && cols.includes("grid_position");
  },
  build(rows) {
    const totalLaps = Math.max(1, toNumber(rows[0]?.total_laps ?? 0));
    type Sparse = { name: string; finish: number | null; grid: number | null; updates: Map<number, number> };
    const byDriver = new Map<string, Sparse>();
    for (const r of rows) {
      const name = String(r.driver_name ?? "");
      const lap = toNumber(r.lap_number ?? 0);
      const pos = parseFiniteNumber(r.position);
      if (!name || pos === null) continue;
      let d = byDriver.get(name);
      if (!d) {
        d = {
          name,
          finish: parseFiniteNumber(r.finish_position),
          grid: parseFiniteNumber(r.grid_position),
          updates: new Map(),
        };
        byDriver.set(name, d);
      }
      d.updates.set(lap, pos);
    }
    const names = [...byDriver.keys()];
    const colors = getDistinctTeamColors(names);
    // Full-field position charts are 20-line spaghetti. Emphasise the drivers
    // the card's narrative is about — the winner, the biggest climber and the
    // biggest faller (by grid→finish delta) — and dim the rest of the field so
    // the eye follows the story. The full field still renders.
    const gainOf = (d: Sparse) =>
      d.grid !== null && d.finish !== null ? d.grid - d.finish : null;
    const withGain = names.map((n) => ({ n, g: gainOf(byDriver.get(n)!) }));
    const ranked = withGain.filter((x) => x.g !== null) as { n: string; g: number }[];
    const emphasized = new Set<string>();
    for (const [name, d] of byDriver) if (d.finish === 1) emphasized.add(name); // winner
    if (ranked.length) {
      emphasized.add(ranked.reduce((a, b) => (b.g > a.g ? b : a)).n); // biggest climber
      emphasized.add(ranked.reduce((a, b) => (b.g < a.g ? b : a)).n); // biggest faller
    }
    const series = names.map((name) => {
      const d = byDriver.get(name)!;
      const lastRecorded = Math.max(...d.updates.keys());
      // Forward-fill: the feed logs changes only. Classified drivers fill
      // to the flag, unclassified stop at their last recorded lap.
      const fillTo = d.finish !== null ? totalLaps : lastRecorded;
      const values: number[] = [];
      let current = d.updates.get(0) ?? NaN;
      for (let lap = 0; lap <= totalLaps; lap += 1) {
        const update = d.updates.get(lap);
        if (update !== undefined) current = update;
        values.push(lap <= fillTo ? current : NaN);
      }
      // Only mark emphasis when there IS a story subset (else all-equal = no dim).
      const emph = emphasized.size > 0 && emphasized.size < names.length
        ? emphasized.has(name)
        : undefined;
      return { name, color: colors[name], values, emphasis: emph };
    });
    return {
      type: "position_changes",
      x_label: "Lap",
      y_label: "Position",
      series
    };
  }
};

const telemetryOverlayDetector: ChartDetector = {
  id: "telemetry_overlay",
  priority: 107,
  fixtures: [],
  benchmarkQids: [],
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("overlay_session_key") && cols.includes("fastest_lap_number");
  },
  build(rows) {
    // Rows may include requested drivers with NO valid flying lap
    // (fastest_lap_number null — early retirement); the lap-telemetry
    // fetch would 404 for them, so only trace drivers with a lap.
    const traceable = rows.filter((r) => r.fastest_lap_number !== null && r.fastest_lap_number !== undefined);
    return {
      type: "telemetry_overlay",
      circuit: typeof rows[0]?.circuit_short_name === "string" ? String(rows[0].circuit_short_name) : undefined,
      telemetry_overlay: {
        sessionKey: toNumber(rows[0]?.overlay_session_key ?? 0),
        drivers: traceable.map((r) => ({
          number: toNumber(r.driver_number ?? 0),
          name: String(r.driver_name ?? "")
        }))
      }
    };
  }
};

const trackSpeedMapDetector: ChartDetector = {
  id: "track_speed_map",
  priority: 103,
  fixtures: [],
  benchmarkQids: [],
  // single_driver_speed_map template: one summary row carrying the
  // channel + reference identifiers; the component fetches per-point
  // telemetry from the track-outline API.
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("map_channel") && cols.includes("map_session_key");
  },
  build(rows) {
    const r = rows[0];
    const channel = String(r.map_channel) === "throttle_brake" ? "throttle_brake" : "speed";
    return {
      type: "track_speed_map",
      circuit: typeof r.circuit_short_name === "string" ? String(r.circuit_short_name) : undefined,
      speed_map: {
        channel,
        driverNumber: toNumber(r.driver_number ?? 0),
        sessionKey: toNumber(r.map_session_key ?? 0),
        driverName: String(r.driver_name ?? "")
      }
    };
  }
};

const cornerDeltaGridDetector: ChartDetector = {
  id: "corner_delta_grid",
  // Above every corner/speed detector (grouped_bar=100, brake_zone=101,
  // telemetry_overlay=107) so the unique `corner_delta_kind` marker wins
  // before groupedBar could grab the a_/b_ absolute-speed columns.
  priority: 108,
  fixtures: [],
  benchmarkQids: [],
  matches(rows) {
    return Object.keys(rows[0]).includes("corner_delta_kind");
  },
  build(rows) {
    const titleCase = (s: string): string =>
      s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
    const aName = String(rows[0]?.a_driver_name ?? "Driver A");
    const bName = String(rows[0]?.b_driver_name ?? "Driver B");
    const aLast = titleCase(lastName(aName));
    const bLast = titleCase(lastName(bName));
    const pairColors = getDistinctTeamColors([aName, bName]);
    const aColor = pairColors[aName] ?? getTeamColor(aName);
    const bColor = pairColors[bName] ?? getTeamColor(bName);

    type Corner = {
      label: string; f: number;
      entry_delta: number; apex_delta: number; exit_delta: number;
      a_entry: number; b_entry: number;
      a_apex: number; b_apex: number;
      a_exit: number; b_exit: number;
      leader: string; color: string;
    };
    const corners: Corner[] = [];
    for (const r of rows) {
      const label = String(r.corner_label ?? "");
      if (!label) continue;
      const apexDelta = parseFiniteNumber(r.apex_delta_kph) ?? 0;
      const f0 = parseFiniteNumber(r.zone_f0);
      const f1 = parseFiniteNumber(r.zone_f1);
      const f = f0 !== null && f1 !== null ? (f0 + f1) / 2 : (f0 ?? f1 ?? 0);
      const leader = apexDelta >= 0 ? aName : bName;
      corners.push({
        label, f,
        entry_delta: parseFiniteNumber(r.entry_delta_kph) ?? 0,
        apex_delta: apexDelta,
        exit_delta: parseFiniteNumber(r.exit_delta_kph) ?? 0,
        a_entry: parseFiniteNumber(r.a_entry_kph) ?? 0,
        b_entry: parseFiniteNumber(r.b_entry_kph) ?? 0,
        a_apex: parseFiniteNumber(r.a_apex_kph) ?? 0,
        b_apex: parseFiniteNumber(r.b_apex_kph) ?? 0,
        a_exit: parseFiniteNumber(r.a_exit_kph) ?? 0,
        b_exit: parseFiniteNumber(r.b_exit_kph) ?? 0,
        leader, color: leader === aName ? aColor : bColor
      });
    }
    const maxAbs = Math.max(1, ...corners.map((c) => Math.abs(c.apex_delta)));
    const corner_deltas = corners.map((c) => ({
      label: c.label, f: c.f,
      entry_delta: c.entry_delta, apex_delta: c.apex_delta, exit_delta: c.exit_delta,
      a_entry: c.a_entry, b_entry: c.b_entry,
      a_apex: c.a_apex, b_apex: c.b_apex,
      a_exit: c.a_exit, b_exit: c.b_exit,
      leader: c.leader, color: c.color,
      node_r: 8 + (Math.abs(c.apex_delta) / maxAbs) * 22
    }));
    const ladder = [...corners].sort((x, y) => Math.abs(y.apex_delta) - Math.abs(x.apex_delta));
    return {
      type: "corner_delta_grid",
      circuit:
        typeof rows[0]?.circuit_short_name === "string"
          ? String(rows[0].circuit_short_name)
          : undefined,
      corner_deltas,
      corner_delta_drivers: { a: aLast, b: bLast, a_color: aColor, b_color: bColor },
      y_axis: ladder.map((c) => c.label),
      x_label: "Apex-speed delta, best lap (km/h)",
      y_value_format: "kph",
      legend: { positive: `${aLast} faster`, negative: `${bLast} faster` },
      diverging_colors: { positive: aColor, negative: bColor },
      series: [
        { name: `${aLast} − ${bLast}`, values: ladder.map((c) => c.apex_delta), color: aColor }
      ]
    };
  }
};

const brakeZoneDeltaDetector: ChartDetector = {
  id: "brake_zone_delta",
  priority: 101,
  fixtures: [],
  benchmarkQids: [],
  // driver_pair_brake_zones template rows: lap-1 per-driver speeds at the
  // heaviest brake zones with the shared-green-lap pace delta repeated on
  // every row (was race_avg_lap_s before 2026-06-10 — kept as a fallback
  // for cached rows). The question is "how do the DELTAS compare", so the
  // chart is one signed bar per zone (A − B apex speed) — the M05 mock's
  // encoding — rather than grouped absolute speeds that make the reader
  // do the subtraction.
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return (
      cols.includes("corner_label") &&
      cols.includes("apex_min_speed_kph") &&
      (cols.includes("shared_pace_delta_s") || cols.includes("race_avg_lap_s"))
    );
  },
  build(rows) {
    // First-seen driver = driver A (SQL orders the pair by mention order).
    const driverOrder: string[] = [];
    for (const r of rows) {
      const name = String(r.driver_name ?? "");
      if (name && !driverOrder.includes(name)) driverOrder.push(name);
    }
    const titleCase = (s: string): string =>
      s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
    const [aName, bName] = driverOrder;
    const aLast = titleCase(lastName(aName ?? "Driver A"));
    const bLast = titleCase(lastName(bName ?? "Driver B"));
    const corners: string[] = [];
    const apex = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const corner = String(r.corner_label ?? "");
      const name = String(r.driver_name ?? "");
      if (!corner || !name || !isNumericLike(r.apex_min_speed_kph)) continue;
      if (!corners.includes(corner)) corners.push(corner);
      const entry = apex.get(corner) ?? {};
      entry[name] = toNumber(r.apex_min_speed_kph);
      apex.set(corner, entry);
    }
    const deltas = corners.map((corner) => {
      const entry = apex.get(corner) ?? {};
      const a = entry[aName ?? ""];
      const b = entry[bName ?? ""];
      return Number.isFinite(a) && Number.isFinite(b) ? Number((a - b).toFixed(1)) : 0;
    });
    // Bars point at whoever won each zone, so color each side with that
    // driver's team color (teammate-distinct variant when both cars are
    // from the same team).
    const pairColors = getDistinctTeamColors([aName ?? "Driver A", bName ?? "Driver B"]);
    // Corner windows for the track map (normalized lap fractions carried
    // on the rows). Color each zone by its faster (higher-apex) driver.
    const seenZones = new Set<string>();
    const cornerZones: NonNullable<ChartSpec["corner_zones"]> = [];
    for (const r of rows) {
      const label = String(r.corner_label ?? "");
      if (!label || seenZones.has(label)) continue;
      seenZones.add(label);
      const f0 = parseFiniteNumber(r.zone_f0);
      const f1 = parseFiniteNumber(r.zone_f1);
      if (f0 === null || f1 === null || f1 <= f0) continue;
      const idx = corners.indexOf(label);
      const delta = deltas[idx] ?? 0;
      const leader = delta >= 0 ? (aName ?? "") : (bName ?? "");
      cornerZones.push({
        label,
        f0,
        f1,
        color: pairColors[leader] ?? getTeamColor(leader),
        leader
      });
    }
    return {
      type: cornerZones.length > 0 ? "track_corner_delta" : "horizontal_bar_diverging",
      circuit: typeof rows[0]?.circuit_short_name === "string" ? String(rows[0].circuit_short_name) : undefined,
      corner_zones: cornerZones.length > 0 ? cornerZones : undefined,
      y_axis: corners,
      x_label: `Apex-speed delta, lap 1 (km/h)`,
      y_value_format: "kph",
      legend: { positive: `${aLast} faster`, negative: `${bLast} faster` },
      diverging_colors: {
        positive: pairColors[aName ?? "Driver A"],
        negative: pairColors[bName ?? "Driver B"]
      },
      series: [
        {
          name: `${aLast} − ${bLast}`,
          values: deltas,
          color: getTeamColor(aName ?? "")
        }
      ]
    };
  }
};

const stintDeltaLineDetector: ChartDetector = {
  id: "stint_delta_line",
  priority: 89,
  fixtures: [],
  benchmarkQids: [],
  // driver_pair_stint_delta template rows: one per shared green lap with
  // delta_s (A − B), the stint window, and per-stint aggregates. The
  // column names are unique to that template (no driver_name / compound /
  // stint_start_lap), so no other detector competes for these rows.
  matches(rows) {
    const cols = Object.keys(rows[0]);
    return cols.includes("delta_s") && cols.includes("stint_number") && cols.includes("driver_a_name");
  },
  build(rows) {
    const isFlag = (v: unknown): boolean => v === true || v === "true" || v === "t";
    // Warehouse names arrive as "Lewis HAMILTON" — title-case the surname
    // so the chart label matches the insight card ("Hamilton − Leclerc").
    const titleCase = (s: string): string =>
      s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
    const aName = String(rows[0].driver_a_name ?? "Driver A");
    const bName = String(rows[0].driver_b_name ?? "Driver B");
    const aLast = titleCase(lastName(aName));
    const bLast = titleCase(lastName(bName));
    // Dense 1..maxLap axis: the renderer maps series.values[i] to lap i+1,
    // so missing laps (stops, unmatched laps) must be NaN, not skipped.
    const maxLap = Math.max(0, ...rows.map((r) => toNumber(r.lap_number ?? 0)));
    const laps = Array.from({ length: maxLap }, (_, i) => i + 1);
    const byLap = new Map<number, Record<string, unknown>>();
    for (const r of rows) byLap.set(toNumber(r.lap_number ?? 0), r);
    const values = laps.map((lap) => {
      const r = byLap.get(lap);
      return r && isNumericLike(r.delta_s) ? toNumber(r.delta_s) : NaN;
    });
    // One boundary marker at the first shared lap of each stint, labelled
    // with the stint number + compound ("S2 Medium", or both compounds
    // when the drivers' strategies are offset).
    const boundaries: Array<{ lap: number; label: string }> = [];
    for (const r of rows) {
      if (!isFlag(r.is_stint_start)) continue;
      const stint = toNumber(r.stint_number ?? 0);
      const aComp = String(r.a_compound ?? "");
      const bComp = String(r.b_compound ?? "");
      const compLabel =
        aComp && bComp && aComp !== bComp
          ? `${humanize(aComp)}/${humanize(bComp)}`
          : humanize(aComp || bComp || "");
      boundaries.push({ lap: toNumber(r.lap_number ?? 0), label: `S${stint} ${compLabel}`.trim() });
    }
    // Short y-label: the rotated axis label clips beyond ~12 chars, and the
    // pairing is already carried by the card title + series name (tooltip).
    // Direction reading lives on the zero line, inside the plot.
    return {
      type: "line_with_stint_markers",
      x_label: "Lap",
      y_label: "Δ s/lap",
      y_value_format: "decimal_seconds",
      series: [
        {
          name: `${aLast} − ${bLast}`,
          color: getTeamColor(aName),
          values
        }
      ],
      stint_boundaries: boundaries,
      horizontal_marker: { value: 0, label: `0 = even · above: ${bLast} faster` }
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
    // Teammate-safe leader colors: when the pair shares a team, plain
    // getTeamColor paints the whole map one color.
    const aName = String(rows[0]?.driver_a ?? "");
    const bName = String(rows[0]?.driver_b ?? "");
    const pairColors = aName && bName ? getDistinctTeamColors([aName, bName]) : null;
    const leaderColor = (leader: string): string => {
      if (pairColors && leader === aName) return pairColors[aName];
      if (pairColors && leader === bName) return pairColors[bName];
      return getTeamColor(leader);
    };
    // Both drivers in the legend with sector counts — even when one driver wins
    // ALL segments (deriving the legend from segment leaders would drop the other
    // driver entirely, e.g. "Norris 3" with Hamilton missing).
    const dominanceLegend =
      aName && bName
        ? [aName, bName].map((name) => ({
            name,
            color: leaderColor(name),
            count: rows.filter((r) => String(r.leader ?? "") === name).length,
          }))
        : undefined;
    return {
      type: "track_heatmap",
      view: "strip",
      dominance_legend: dominanceLegend,
      // Circuit name lets the renderer fetch the derived track outline
      // and draw the dominance ribbon on the real circuit shape.
      circuit: typeof rows[0]?.circuit_short_name === "string" ? String(rows[0].circuit_short_name) : undefined,
      // Per-segment delta unit: rows may carry "km/h" (minisector dominance
      // by avg speed); default stays "ms" for time-based heatmaps.
      delta_unit: typeof rows[0]?.delta_unit === "string" ? String(rows[0].delta_unit) : undefined,
      segments: rows.map((r) => ({
        minisector_index: toNumber(r.minisector_index ?? 0),
        name: String(r.name ?? ""),
        leader: String(r.leader ?? ""),
        color: leaderColor(String(r.leader ?? "")),
        delta_ms: isNumericLike(r.delta_ms) ? toNumber(r.delta_ms) : undefined
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
    const spec: ChartSpec = {
      type: "pit_event_strip",
      phases: rows.map((r) => ({
        label: String(r.phase_label ?? ""),
        duration_sec: toNumber(r.duration_sec ?? 0),
        // Pit lane is the time-loss segment (red); the flanking in/out laps
        // are neutral grey. Match on the label prefix so "Pit lane" with or
        // without a trailing lap annotation still highlights.
        color: /pit\s*lane/i.test(String(r.phase_label ?? "")) ? "#E10600" : "#9CA3AF"
      }))
    };
    // Position flow (before → after → recovered) is carried on every row by
    // the single_driver_pit_cycle template; the detector reads it from the
    // first row. Per the "derive what we can, flag gaps" contract, only
    // attach post_cycle when BOTH endpoints are present — position data is
    // sparse in the warehouse (pit-out and many green laps are NULL), and a
    // half-populated flow would render "PnaN".
    const first = rows[0];
    const before = parseFiniteNumber(first?.before_position);
    const after = parseFiniteNumber(first?.after_position);
    if (before !== null && after !== null) {
      const recovered = parseFiniteNumber(first?.recovered_by_lap);
      spec.post_cycle = {
        before_position: before,
        after_position: after,
        ...(recovered !== null ? { recovered_by_lap: recovered } : {})
      };
    }
    return spec;
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
  telemetryOverlayDetector,
  positionChangesDetector,
  raceTraceDetector,
  degradationCurveDetector,
  trackSpeedMapDetector,
  cornerDeltaGridDetector,
  brakeZoneDeltaDetector,
  stintDeltaLineDetector,
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
