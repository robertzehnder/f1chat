import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `single_driver_speed_map`. One summary row;
 *  the gradient ribbon is rendered client-side from the same lap's
 *  telemetry via the track-outline API. */

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

export type SpeedMapInsightResult = { answer: string; insight: InsightFields };

export function buildSpeedMapInsight(rows: Row[] | undefined): SpeedMapInsightResult | null {
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  if (!("map_channel" in r) || !("fastest_lap_number" in r)) return null;

  const name = str(r.driver_name) ?? "Driver";
  const surname = lastName(name);
  const venue = str(r.location) ?? str(r.country_name);
  const year = num(r.year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const channel = str(r.map_channel) ?? "speed";
  const lapNumber = num(r.fastest_lap_number);
  const lapDuration = num(r.lap_duration);
  const maxSpeed = num(r.max_speed_kph);
  const minSpeed = num(r.min_speed_kph);
  const traction = channel === "throttle_brake";

  const metrics: InsightFieldMetric[] = [
    {
      label: "Reference lap",
      value: lapNumber !== null ? `Lap ${lapNumber}` : "n/a",
      context: lapDuration !== null ? `${surname}'s fastest valid: ${fmtLap(lapDuration)}` : undefined,
      emphasis: true
    },
    { label: "Top speed", value: maxSpeed !== null ? `${maxSpeed.toFixed(0)} km/h` : "n/a", context: "on the reference lap" },
    { label: "Slowest point", value: minSpeed !== null ? `${minSpeed.toFixed(0)} km/h` : "n/a", context: "apex minimum" }
  ];

  const takeaways = [
    traction
      ? `Map shows traction zones on ${surname}'s fastest lap: green = full throttle, red = braking, grey = coasting/partial`
      : `Map colors ${surname}'s fastest lap by speed — blue slowest through red fastest (${minSpeed?.toFixed(0) ?? "?"}–${maxSpeed?.toFixed(0) ?? "?"} km/h)`,
    `Green outer bands mark the circuit's DRS zones (detected from a qualifying push lap, where DRS use is unrestricted)`,
    `Single-lap snapshot (lap ${lapNumber ?? "?"}) — telemetry sampled at ~3.7 Hz, so very short events can fall between samples`
  ];

  const answer = traction
    ? `${surname}'s traction zones at ${venueYear || "this circuit"}, from his fastest valid lap (lap ${lapNumber ?? "?"}, ${lapDuration !== null ? fmtLap(lapDuration) : "n/a"}): the map shows where the car is at full throttle (green), braking (red), and in transition (grey). DRS zones are banded where detected.`
    : `${surname}'s speed map at ${venueYear || "this circuit"}, from his fastest valid lap (lap ${lapNumber ?? "?"}, ${lapDuration !== null ? fmtLap(lapDuration) : "n/a"}): the ribbon runs from ${minSpeed?.toFixed(0) ?? "?"} km/h at the slowest apex (blue) to ${maxSpeed?.toFixed(0) ?? "?"} km/h at the fastest point (red). DRS zones are banded where detected.`;

  return {
    answer,
    insight: {
      title: traction
        ? `Traction Zones — ${surname}${venueYear ? ` · ${venueYear}` : ""}`
        : `Speed Map — ${surname}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(r.session_name) ?? "Race", `fastest lap ${lapNumber ?? "?"}`].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways,
      related_questions: [
        `Compare ${surname}'s corner speeds against a rival at ${venueYear || "this race"}`,
        `Which sectors did ${surname} own at ${venueYear || "this race"}?`,
        traction ? `Show ${surname}'s speed map at ${venueYear || "this race"}` : `Show ${surname}'s traction zones at ${venueYear || "this race"}`
      ]
    }
  };
}
