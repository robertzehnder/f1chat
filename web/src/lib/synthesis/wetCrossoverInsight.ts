import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_wet_crossover` (M14).
 *  Per-lap rows for two drivers with lap_time_s + wet_track flag + the
 *  precomputed inter_to_slick_crossover_lap. The dual-axis line chart is
 *  attached client-side (lap time on y1, wet-track indicator on y2). */

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

export type WetCrossoverInsightResult = { answer: string; insight: InsightFields };

export function buildWetCrossoverInsight(rows: Row[] | undefined): WetCrossoverInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("inter_to_slick_crossover_lap" in rows[0]) || !("wet_track" in rows[0])) return null;

  // First row per driver carries the per-driver crossover lap. Per-lap
  // compound_name gives the full tyre story: consecutive same-compound
  // runs are stints, every transition is a pit stop.
  type Stint = { compound: string; start: number; end: number };
  const byDriver = new Map<string, { surname: string; crossover: number | null; stints: Stint[] }>();
  for (const r of rows) {
    const name = str(r.driver_name);
    if (!name) continue;
    let d = byDriver.get(name);
    if (!d) {
      d = { surname: lastName(name), crossover: num(r.inter_to_slick_crossover_lap), stints: [] };
      byDriver.set(name, d);
    }
    const lap = num(r.lap_number);
    const compound = str(r.compound_name)?.toUpperCase() ?? null;
    if (lap === null || !compound) continue;
    const current = d.stints[d.stints.length - 1];
    if (current && current.compound === compound && lap >= current.start) {
      current.end = Math.max(current.end, lap);
    } else if (!current || current.compound !== compound) {
      d.stints.push({ compound, start: lap, end: lap });
    }
  }
  const drivers = [...byDriver.values()];
  if (drivers.length === 0) return null;
  const SHORT: Record<string, string> = { INTERMEDIATE: "Int", MEDIUM: "Med", SOFT: "Soft", HARD: "Hard", WET: "Wet" };
  const shortCompound = (c: string) => SHORT[c] ?? c.charAt(0) + c.slice(1).toLowerCase();
  const sequenceText = (d: { stints: Stint[] }) =>
    d.stints.map((s) => `${shortCompound(s.compound)} ${s.start}–${s.end}`).join(" → ");
  // Compound each driver switched onto at the crossover (their stint
  // starting at/after the crossover lap).
  const slickAt = (d: { crossover: number | null; stints: Stint[] }): string | null => {
    if (d.crossover === null) return null;
    const stint = d.stints.find((s) => s.start >= d.crossover!);
    return stint ? shortCompound(stint.compound) : null;
  };

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const wetLaps = new Set(rows.filter((r) => num(r.wet_track) === 1).map((r) => num(r.lap_number))).size;

  // F17 (golden-set audit 2026-07-02): inter_to_slick_crossover_lap is the
  // FIRST inter→slick switch, which for an opening-laps gamble (Int 1–2 →
  // slick 3, before the track had dried) is not a drying-phase crossover at
  // all. Comparing that lap-3 gamble to a real lap-39 drying crossover
  // fabricated "one car gambled on the dry line earlier". Only a switch
  // AFTER the wet phase began counts as a genuine drying crossover.
  const wetLapNumbers = rows.filter((r) => num(r.wet_track) === 1).map((r) => num(r.lap_number)!);
  const wetPhaseStart = wetLapNumbers.length ? Math.min(...wetLapNumbers) : null;
  const isDryingCrossover = (lap: number | null): boolean =>
    lap !== null && wetPhaseStart !== null && lap >= wetPhaseStart;

  const withCrossover = drivers.filter((d) => d.crossover !== null);
  const genuineCrossover = withCrossover.filter((d) => isDryingCrossover(d.crossover));
  const crossoverText =
    genuineCrossover.length === 0
      ? null
      : genuineCrossover.every((d) => d.crossover === genuineCrossover[0].crossover)
        ? `lap ${genuineCrossover[0].crossover}`
        : genuineCrossover.map((d) => `${d.surname} lap ${d.crossover}`).join(", ");

  const metrics: InsightFieldMetric[] = drivers.slice(0, 2).map((d) => {
    if (d.crossover !== null && !isDryingCrossover(d.crossover)) {
      return {
        label: `${d.surname}`,
        value: `Lap ${d.crossover} gamble`,
        context: "early slick gamble, not a drying-phase crossover",
        emphasis: false
      };
    }
    return {
      label: `${d.surname} crossover`,
      value: d.crossover !== null ? `Lap ${d.crossover}` : "n/a",
      context:
        d.crossover !== null
          ? `inters → ${slickAt(d)?.toLowerCase() ?? "slicks"}`
          : "no crossover recorded",
      emphasis: d.crossover !== null
    };
  });
  metrics.push({ label: `Wet-flagged lap${wetLaps === 1 ? "" : "s"}`, value: String(wetLaps), context: "track wet indicator" });

  // Only compare spread across GENUINE drying crossovers.
  const sameLap = genuineCrossover.length >= 2 && genuineCrossover.every((d) => d.crossover === genuineCrossover[0].crossover);
  const crossoverSpread =
    genuineCrossover.length >= 2
      ? Math.max(...genuineCrossover.map((d) => d.crossover!)) - Math.min(...genuineCrossover.map((d) => d.crossover!))
      : 0;
  const gambleDrivers = withCrossover.filter((d) => !isDryingCrossover(d.crossover));
  // F26 (golden-set audit 2026-07-02): name the requested drivers who never
  // crossed over at all — the prompt asked about them, and the headline
  // silently dropped them (Alonso retired on inters, no crossover recorded).
  const raceMaxLap = Math.max(...rows.map((r) => num(r.lap_number) ?? 0), 0);
  const lastLapOf = (d: { stints: Stint[] }): number => Math.max(...d.stints.map((s) => s.end), 0);
  const neverCrossed = drivers.filter((d) => d.crossover === null);
  const takeaways = [
    crossoverText ? `Inter→slick crossover: ${crossoverText}` : `No drying-phase inter→slick crossover recorded for these drivers`,
    ...neverCrossed.map((d) => {
      const last = lastLapOf(d);
      return last > 0 && last < raceMaxLap
        ? `${d.surname} never switched to slicks — retired on lap ${last} still on intermediates`
        : `${d.surname} never switched to slicks — stayed on intermediates to the flag`;
    }),
    gambleDrivers.length
      ? `${gambleDrivers.map((d) => `${d.surname} switched to slicks on lap ${d.crossover}`).join(" and ")} — an early gamble before the track dried, not a drying-phase crossover`
      : ``,
    sameLap
      ? `Both cars crossed over on the same lap — no strategic split on the dry-line call`
      : genuineCrossover.length >= 2
        ? crossoverSpread <= 2
          ? `Crossed over ${crossoverSpread} lap${crossoverSpread === 1 ? "" : "s"} apart — effectively the same dry-line call, staggered to cover the pit stops`
          : `Crossover laps differ by ${crossoverSpread} laps — one car gambled on the dry line earlier`
        : ``,
    ...drivers
      .filter((d) => d.stints.length > 0)
      .map((d) => `${d.surname} tyres: ${sequenceText(d)} (each switch = a pit stop, marked on the chart)`),
    `${wetLaps} lap${wetLaps === 1 ? "" : "s"} carr${wetLaps === 1 ? "ies" : "y"} the wet-track flag; the lap-time trace shows the pace step at the crossover`,
    `Crossover lap from the per-lap weather-impact model (compound switch onto slicks)`
  ].filter(Boolean);

  const gambleSentence = gambleDrivers.length
    ? ` ${gambleDrivers.map((d) => `${d.surname} took an early slick gamble on lap ${d.crossover}, before the track had dried`).join("; ")}.`
    : "";
  const answer = crossoverText
    ? `The inter-to-slick crossover at ${venueYear || "this race"} came on ${crossoverText}` +
      (sameLap ? ` for both drivers — they switched together as the track dried` : "") +
      `.${gambleSentence} The chart shows each car's lap times with the wet-track indicator: the pace step at the crossover marks where slicks became the faster tyre. ${wetLaps} lap${wetLaps === 1 ? "" : "s"} ${wetLaps === 1 ? "was" : "were"} flagged wet. The crossover lap and tyre sequences are inferred from the per-lap weather-impact model and compound data, not from an official pit-stop record.`
    : gambleDrivers.length
      ? `No drying-phase inter-to-slick crossover is recorded for these drivers at ${venueYear || "this race"}.${gambleSentence} That is an opening-laps gamble, not a crossover as the track dried.`
      : `No inter-to-slick crossover is recorded for these drivers at ${venueYear || "this race"} — the weather-impact model shows no inters-to-slicks compound switch.`;

  return {
    answer,
    insight: {
      title: `Inter → Slick Crossover${venueYear ? ` — ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", drivers.map((d) => d.surname).join(" vs ")].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Who was fastest in the wet phase at ${venueYear || "this race"}?`,
        `Did anyone gamble on slicks earlier and gain?`,
        `Show the pit stops around the crossover window`
      ]
    }
  };
}
