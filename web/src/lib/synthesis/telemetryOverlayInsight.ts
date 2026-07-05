import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_telemetry_overlay`.
 *  One summary row per driver (fastest valid lap + top speed); the
 *  stacked traces render client-side from /api/lap-telemetry. */

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function lastName(fullName: string): string {
  const last = fullName.trim().split(/\s+/).pop() ?? fullName;
  return last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : fullName;
}
function fmtLap(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }
  return `${sec.toFixed(3)}s`;
}

export type TelemetryOverlayInsightResult = { answer: string; insight: InsightFields };

export function buildTelemetryOverlayInsight(rows: Row[] | undefined): TelemetryOverlayInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("overlay_session_key" in rows[0]) || !("fastest_lap_number" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const parsed = rows.map((r) => ({
    name: str(r.driver_name) ?? "Driver",
    surname: lastName(str(r.driver_name) ?? "Driver"),
    lap: num(r.fastest_lap_number),
    duration: num(r.lap_duration),
    topSpeed: num(r.top_speed_kph),
    lapsCompleted: num(r.laps_completed)
  }));
  const drivers = parsed.filter((d) => d.lap !== null);
  // Requested drivers with no valid flying lap (retired early, no clean
  // lap) — the card must say so, not silently shrink to fewer drivers.
  const missing = parsed.filter((d) => d.lap === null);
  if (drivers.length === 0) return null;

  const metrics: InsightFieldMetric[] = drivers.slice(0, 2).map((d) => ({
    label: `${d.surname} · lap ${d.lap}`,
    value: d.duration !== null ? fmtLap(d.duration) : "n/a",
    context: d.topSpeed !== null ? `top speed ${d.topSpeed.toFixed(0)} km/h` : undefined,
    emphasis: drivers.length < 2 || d.duration === Math.min(...drivers.map((x) => x.duration ?? Infinity))
  }));
  if (drivers.length === 2 && drivers[0].duration !== null && drivers[1].duration !== null) {
    const diff = Math.abs(drivers[0].duration - drivers[1].duration);
    const faster = drivers[0].duration <= drivers[1].duration ? drivers[0] : drivers[1];
    metrics.push({ label: "Lap delta", value: `${diff.toFixed(3)}s`, context: `${faster.surname} faster` });
  }
  for (const m of missing) {
    metrics.push({
      label: m.surname,
      value: "no valid lap",
      context: `completed ${m.lapsCompleted ?? 0} lap${m.lapsCompleted === 1 ? "" : "s"} — retired early or no clean lap`
    });
  }

  const missingText = (m: (typeof missing)[number]): string =>
    `${m.surname} has no valid flying lap in this session (completed ${m.lapsCompleted ?? 0} lap${m.lapsCompleted === 1 ? "" : "s"} — an early retirement or no clean lap)`;

  const takeaways = [
    ...drivers.map(
      (d) => `${d.surname}: fastest valid lap ${d.lap}${d.duration !== null ? ` (${fmtLap(d.duration)})` : ""}${d.topSpeed !== null ? `, ${d.topSpeed.toFixed(0)} km/h peak` : ""}`
    ),
    ...missing.map(missingText),
    `Stacked traces: speed, gear, throttle/brake — aligned by lap distance, corner ticks from the circuit's segment map`,
    `Each driver's own fastest valid green lap (laps may differ — this compares best efforts, not the same moment)`
  ];

  const answer =
    drivers.length === 2
      ? `Telemetry overlay of ${drivers[0].surname} and ${drivers[1].surname}'s fastest laps at ${venueYear || "this session"}: speed, gear and pedal traces aligned by lap distance — divergences in the speed trace show exactly which corners decided the ${metrics[2]?.value ?? ""} gap.`
      : missing.length > 0
        ? `The requested comparison isn't possible at ${venueYear || "this session"}: ${missing.map(missingText).join("; ")}, so there is nothing to overlay against. Showing ${drivers[0].surname}'s fastest lap instead — lap ${drivers[0].lap}${drivers[0].duration !== null ? ` (${fmtLap(drivers[0].duration)})` : ""}${drivers[0].topSpeed !== null ? `, ${drivers[0].topSpeed.toFixed(0)} km/h peak` : ""}.`
        : `${drivers[0].surname}'s fastest-lap telemetry at ${venueYear || "this session"}: stacked speed, gear, and throttle/brake traces aligned by lap distance.`;

  return {
    answer,
    insight: {
      title:
        drivers.length === 2
          ? `Telemetry — ${drivers[0].surname} vs ${drivers[1].surname}${venueYear ? ` · ${venueYear}` : ""}`
          : `Telemetry — ${drivers[0].surname}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [
        venueYear || venue,
        str(rows[0].session_name) ?? "Session",
        missing.length ? `no valid lap for ${missing.map((m) => m.surname).join(", ")}` : "fastest valid laps"
      ]
        .filter(Boolean)
        .join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Which sectors split ${drivers.map((d) => d.surname).join(" and ")} at ${venueYear || "this session"}?`,
        `Show the speed map for ${drivers[0].surname} at ${venueYear || "this session"}`,
        `Compare their brake zones at ${venueYear || "this session"}`
      ]
    }
  };
}
