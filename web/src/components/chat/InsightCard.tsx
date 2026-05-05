"use client";

// Phase 26 UI: F1-Insights-style assistant card. Renders a card
// with a red status dot + title (heuristic from question/SQL),
// a body paragraph (the LLM answer text), auto-derived metric
// tiles (when the result rows expose simple numeric aggregates),
// an optional driver-by-corner bar chart (when the result is
// shaped as multi-driver corner-comparison rows), and the
// follow-up suggestion chips.
//
// All derivations are heuristic over the result rows the LLM
// already produced; this is purely presentational and does NOT
// change synthesis behavior.

import { CollapsibleBlock } from "@/components/chat/CollapsibleBlock";
import { ResultTable } from "@/components/chat/ResultTable";
import { getDriverPalette } from "@/lib/teamColors";

type Cell = string | number | null;
type Row = Record<string, Cell>;

type Metric = {
  label: string;
  value: string;
  unit?: string;
  emphasis?: boolean;
};

type CornerBar = {
  cornerLabel: string;
  drivers: { name: string; value: number; color: string }[];
};

const SPEED_KEYS = new Set([
  "entry_speed_kph",
  "apex_min_speed_kph",
  "exit_speed_kph",
  "max_speed",
  "i1_speed_kph",
  "i2_speed_kph",
  "st_speed_kph"
]);

const COUNT_KEYS = new Set([
  "sample_count",
  "valid_lap_count",
  "lap_samples",
  "rowcount"
]);

function pickTitle(rows: Row[], fallback: string): string {
  const first = rows[0] ?? {};
  if (first["corner_label"]) return `${first["corner_label"]} Analysis`;
  if (first["session_name"]) return String(first["session_name"]);
  return fallback;
}

function pickSubtitle(rows: Row[]): string | null {
  const first = rows[0] ?? {};
  const parts: string[] = [];
  if (first["year"]) parts.push(String(first["year"]));
  if (first["country_name"]) parts.push(String(first["country_name"]));
  if (first["session_name"] && !first["country_name"]) {
    parts.push(String(first["session_name"]));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function isNumeric(v: Cell): v is number {
  if (v === null || v === undefined) return false;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n);
}

function num(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Derive ≤3 metric tiles from the result rows. Picks the first
 *  three numeric columns whose name matches one of our hint keys
 *  (speed / count / pace). Falls back to "first three numeric
 *  cells in row 1" if nothing matches. */
function deriveMetrics(rows: Row[]): Metric[] {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const keys = Object.keys(sample);
  const speedKeys = keys.filter((k) => SPEED_KEYS.has(k.toLowerCase()));
  const countKeys = keys.filter((k) => COUNT_KEYS.has(k.toLowerCase()));

  const out: Metric[] = [];

  // For speed-shaped results, show the avg of the named speed
  // columns across rows.
  for (const key of speedKeys.slice(0, 2)) {
    const values = rows.map((r) => num(r[key])).filter((v): v is number => v !== null);
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    out.push({
      label: prettyLabel(key, "Avg"),
      value: avg.toFixed(1),
      unit: "km/h"
    });
    if (out.length < 2) {
      out.push({
        label: prettyLabel(key, "Max"),
        value: max.toFixed(1),
        unit: "km/h",
        emphasis: true
      });
    }
  }

  // Add a count tile if available.
  for (const key of countKeys.slice(0, 1)) {
    const values = rows.map((r) => num(r[key])).filter((v): v is number => v !== null);
    if (values.length === 0) continue;
    const total = values.reduce((a, b) => a + b, 0);
    out.push({
      label: "Laps Analyzed",
      value: String(rows.length === 1 ? total : rows.length),
      unit: rows.length === 1 ? "samples" : "rows"
    });
    break;
  }

  // Fallback when nothing matched: surface up to 3 numeric cells
  // from row 0.
  if (out.length === 0) {
    for (const key of keys) {
      if (out.length >= 3) break;
      const v = sample[key];
      if (!isNumeric(v)) continue;
      const n = num(v) ?? 0;
      out.push({ label: prettyLabel(key), value: formatNumber(n) });
    }
  }

  return out.slice(0, 3);
}

function prettyLabel(key: string, prefix?: string): string {
  const base = key
    .replace(/_/g, " ")
    .replace(/kph/i, "")
    .trim()
    .replace(/\s+/g, " ");
  const titled = base
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return prefix ? `${prefix} ${titled}` : titled;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

/** Detect whether the result is shaped as multi-driver per-corner
 *  rows (one row per (driver, corner)) and emit bar-chart data. */
function deriveCornerChart(rows: Row[]): CornerBar[] | null {
  if (rows.length < 2) return null;
  const sample = rows[0];
  const hasCorner = "corner_label" in sample || "corner_number" in sample;
  const hasDriver = "driver_number" in sample || "driver_name" in sample;
  const speedKey = ["entry_speed_kph", "apex_min_speed_kph", "exit_speed_kph", "i1_speed_kph", "i2_speed_kph"]
    .find((k) => k in sample);
  if (!hasCorner || !hasDriver || !speedKey) return null;

  // Group by corner_label / corner_number; within each, list per driver.
  const byCorner = new Map<string, { name: string; value: number; color: string }[]>();
  for (const r of rows) {
    const corner =
      String(r["corner_label"] ?? `Turn ${r["corner_number"] ?? "?"}`);
    const driverName = String(
      r["driver_name"] ?? `#${r["driver_number"] ?? "?"}`
    );
    const driverNumber = num(r["driver_number"] ?? null);
    const value = num(r[speedKey]);
    if (value === null) continue;
    const palette = getDriverPalette(driverNumber);
    const arr = byCorner.get(corner) ?? [];
    arr.push({ name: driverName, value, color: palette.primary });
    byCorner.set(corner, arr);
  }

  const result: CornerBar[] = Array.from(byCorner.entries())
    .map(([cornerLabel, drivers]) => ({ cornerLabel, drivers }))
    // Order by corner_number when present (T1 < T2 < ... < T18)
    .sort((a, b) => {
      const an = parseInt(a.cornerLabel.match(/(\d+)/)?.[1] ?? "0", 10);
      const bn = parseInt(b.cornerLabel.match(/(\d+)/)?.[1] ?? "0", 10);
      return an - bn;
    });

  // Only render the chart when ≥2 corners AND ≥2 distinct drivers
  // appear (otherwise a chart adds no value over the metrics tiles).
  const allDrivers = new Set<string>();
  for (const c of result) for (const d of c.drivers) allDrivers.add(d.name);
  if (result.length < 2 || allDrivers.size < 2) return null;

  return result;
}

function CornerBarChart({ data }: { data: CornerBar[] }) {
  // Compute the y-axis range across all bars.
  const allValues = data.flatMap((c) => c.drivers.map((d) => d.value));
  const max = Math.max(...allValues);
  const min = Math.min(...allValues);
  const yMax = Math.ceil(max + (max - min) * 0.1);
  const yMin = Math.max(0, Math.floor(min - (max - min) * 0.2));
  const range = yMax - yMin || 1;

  // Layout
  const chartHeight = 200;
  const cornerWidth = 120;
  const barWidth = 32;
  const barGap = 8;
  const driverColors: Record<string, string> = {};
  for (const c of data) for (const d of c.drivers) driverColors[d.name] = d.color;
  const driverNames = Object.keys(driverColors);

  // 4 evenly-spaced y-axis labels.
  const yLabels = [0, 1, 2, 3].map((i) => yMin + (range * i) / 3);

  return (
    <div className="mt-4">
      <div className="flex">
        {/* Y axis */}
        <div className="flex flex-col-reverse justify-between pr-3 text-xs text-ink-tertiary"
             style={{ height: chartHeight }}>
          {yLabels.map((v) => (
            <span key={v}>{v.toFixed(1)}</span>
          ))}
        </div>
        {/* Chart area */}
        <div className="flex flex-1 items-end gap-1 border-l border-b border-border-subtle pl-1" style={{ height: chartHeight }}>
          {data.map((corner) => (
            <div
              key={corner.cornerLabel}
              className="flex h-full flex-col items-center justify-end"
              style={{ minWidth: cornerWidth }}
            >
              <div className="flex h-full items-end gap-1">
                {corner.drivers.map((d) => {
                  const h = ((d.value - yMin) / range) * chartHeight;
                  return (
                    <div
                      key={d.name}
                      title={`${d.name}: ${d.value.toFixed(1)}`}
                      className="rounded-t-sm transition-opacity hover:opacity-80"
                      style={{
                        width: barWidth,
                        height: Math.max(2, h),
                        background: d.color
                      }}
                    />
                  );
                })}
              </div>
              <span className="mt-2 text-xs text-ink-tertiary">
                {corner.cornerLabel
                  .replace(/Turn (\d+).*/, "T$1")
                  .replace(/^(.{12}).+/, "$1…")}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-ink-secondary">
        {driverNames.map((name) => (
          <span key={name} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: driverColors[name] }}
            />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

type InsightCardProps = {
  title: string;
  subtitle?: string | null;
  bodyText?: string;
  rows?: Row[];
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
  sql?: string;
  followUps?: string[];
  warnings?: string[];
  onFollowUp?: (prompt: string) => void;
};

export function InsightCard({
  title,
  subtitle,
  bodyText,
  rows,
  rowCount,
  elapsedMs,
  truncated,
  sql,
  followUps,
  warnings,
  onFollowUp
}: InsightCardProps) {
  const usableRows = rows ?? [];
  const metrics = deriveMetrics(usableRows);
  const chart = deriveCornerChart(usableRows);
  const resolvedTitle = pickTitle(usableRows, title);
  const resolvedSubtitle = pickSubtitle(usableRows) ?? subtitle ?? null;

  return (
    <article className="rounded-2xl border border-border bg-surface p-6">
      <header className="mb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-block size-2 rounded-full bg-accent" />
          <h2 className="m-0 text-base font-semibold text-ink">{resolvedTitle}</h2>
        </div>
        {resolvedSubtitle ? (
          <p className="m-0 mt-1 pl-[18px] text-sm text-ink-tertiary">{resolvedSubtitle}</p>
        ) : null}
      </header>

      {bodyText ? (
        <p className="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{bodyText}</p>
      ) : null}

      {/* Metric tiles */}
      {metrics.length > 0 ? (
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-border-subtle pt-5">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col items-center text-center">
              <span
                className={`font-mono text-3xl font-semibold ${
                  m.emphasis ? "text-semantic-success" : "text-ink"
                }`}
              >
                {m.value}
              </span>
              <span className="mt-1 text-xs text-ink-secondary">{m.label}</span>
              {m.unit ? <span className="text-[11px] text-ink-tertiary">{m.unit}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Bar chart for multi-driver corner comparisons */}
      {chart ? <CornerBarChart data={chart} /> : null}

      {/* Warnings */}
      {warnings && warnings.length > 0 ? (
        <div className="mt-4 rounded-md border-l-[3px] border-l-semantic-warning bg-semantic-warning-soft px-3 py-2.5">
          <p className="m-0 mb-1 text-[13px] font-semibold text-semantic-warning">Note</p>
          <ul className="m-0 list-disc pl-4 text-[13px] text-ink-secondary">
            {warnings.map((w, j) => (
              <li key={j}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Related questions */}
      {followUps && followUps.length > 0 ? (
        <div className="mt-5 border-t border-border-subtle pt-4">
          <p className="m-0 mb-2 text-xs uppercase tracking-wide text-ink-tertiary">Related questions</p>
          <div className="flex flex-wrap gap-2">
            {followUps.map((p, j) => (
              <button
                key={j}
                type="button"
                onClick={() => onFollowUp?.(p)}
                className="rounded-full border border-border bg-surface-secondary px-3.5 py-1.5 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Collapsible SQL + result rows for transparency */}
      {sql ? (
        <div className="mt-4">
          <CollapsibleBlock title="SQL" variant="code">
            <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-ink">
              {sql}
            </pre>
          </CollapsibleBlock>
        </div>
      ) : null}

      {usableRows.length > 0 ? (
        <div className="mt-3">
          <ResultTable
            title="Result"
            rows={usableRows}
            rowCount={rowCount}
            elapsedMs={elapsedMs}
            truncated={truncated}
          />
        </div>
      ) : null}
    </article>
  );
}
