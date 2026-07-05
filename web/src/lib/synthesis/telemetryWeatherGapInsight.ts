import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `sessions_telemetry_without_weather` (M18).
 *  The key job: when the gap count is ZERO, say "full coverage" instead
 *  of the generic "No rows matched" (rows are returned either way — one
 *  per telemetry session, missing-weather sessions first). */

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type TelemetryWeatherGapInsightResult = { answer: string; insight: InsightFields };

export function buildTelemetryWeatherGapInsight(rows: Row[] | undefined): TelemetryWeatherGapInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("telemetry" in rows[0]) || !("weather" in rows[0]) || !("session_label" in rows[0])) return null;

  const year = num(rows[0].year);
  const missing = rows.filter((r) => str(r.weather) === "missing");
  const shown = rows.length;
  const yearLabel = year !== null ? String(year) : "the dataset";

  const metrics: InsightFieldMetric[] = [
    { label: "Missing weather", value: String(missing.length), context: missing.length ? "sessions with telemetry, no weather" : "no gaps found", emphasis: true },
    { label: "Telemetry sessions", value: `${shown}${shown >= 30 ? "+" : ""}`, context: `checked in ${yearLabel}` }
  ];

  const takeaways: string[] = missing.length
    ? [
        `${missing.length} session${missing.length === 1 ? "" : "s"} have car telemetry but no weather rows`,
        ...missing.slice(0, 3).map((r) => `Gap: ${str(r.session_label)}`),
        `Coverage grid below — missing-weather sessions sort first`
      ]
    : [
        `Every checked session with telemetry also has weather data — no gaps in ${yearLabel}`,
        `Coverage checked against raw.car_data and raw.weather presence per session`,
        shown >= 30 ? `Grid shows the first ${shown} telemetry sessions (display cap)` : `All ${shown} telemetry sessions shown`
      ];

  const answer = missing.length
    ? `${missing.length} session${missing.length === 1 ? "" : "s"} in ${yearLabel} have telemetry but no matching weather data: ` +
      `${missing.slice(0, 5).map((r) => str(r.session_label)).filter(Boolean).join("; ")}` +
      (missing.length > 5 ? ` (and ${missing.length - 5} more — see the grid)` : "") + `.`
    : `None — every session in ${yearLabel} that has car telemetry also has matching weather data. ` +
      `The coverage grid below shows the checked sessions, all with full weather coverage.`;

  return {
    answer,
    insight: {
      title: `Telemetry vs Weather Coverage — ${yearLabel}`,
      subtitle: [`${shown} telemetry sessions checked`, missing.length ? `${missing.length} gaps` : "no gaps"].join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Which ${yearLabel} sessions are missing lap data?`,
        `Which sessions have the most complete telemetry coverage?`,
        `Show per-table row counts for a specific session`
      ]
    }
  };
}
