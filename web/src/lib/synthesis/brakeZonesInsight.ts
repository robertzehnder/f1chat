import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_brake_zones` (M05).
 *  Rows: lap-1 entry/apex speeds for both drivers at the three heaviest
 *  brake zones, with the shared-green-lap pace delta (median of per-lap
 *  A−B differences over laps both ran green) repeated on every row.
 *  Verdict: did the lap-1 brake-zone deficit foreshadow the race-pace
 *  deficit (same driver behind in both)? Grouped bar attached client-side. */

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

export type BrakeZonesInsightResult = { answer: string; insight: InsightFields };

export function buildBrakeZonesInsight(rows: Row[] | undefined): BrakeZonesInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("brake_drop_kph" in rows[0]) || !("corner_label" in rows[0])) return null;

  type DriverZone = { entry: number | null; apex: number | null };
  const corners: string[] = [];
  const byDriver = new Map<string, { surname: string; zones: Map<string, DriverZone> }>();
  for (const r of rows) {
    const name = str(r.driver_name);
    const corner = str(r.corner_label);
    if (!name || !corner) continue;
    if (!corners.includes(corner)) corners.push(corner);
    let d = byDriver.get(name);
    if (!d) {
      d = { surname: lastName(name), zones: new Map() };
      byDriver.set(name, d);
    }
    d.zones.set(corner, { entry: num(r.entry_speed_kph), apex: num(r.apex_min_speed_kph) });
  }
  const drivers = [...byDriver.values()];
  if (drivers.length !== 2 || corners.length === 0) return null;
  const [a, b] = drivers;

  // Shared-green-lap pace delta, a − b (negative = a faster), median over
  // laps both drivers ran green so mixed conditions cancel out.
  const sharedPaceDelta = num(rows[0].shared_pace_delta_s);
  const sharedGreenLaps = num(rows[0].shared_green_laps);

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  // Lap-1 brake-zone signal: mean apex-speed delta (A − B) across zones
  // where both have data. Positive = A carried more speed.
  // Lap-1 corner samples include cars that were stopped, blocked, or off
  // line (Spa 2025: Russell apex 0 km/h at Eau Rouge; Silverstone 2025:
  // Leclerc entry 140 vs Piastri 255 at Club) — an apex below 40 km/h on
  // a heavy brake zone is jostling/incident artifact, not pace. Those
  // zones are flagged and kept on the chart but excluded from the average.
  const APEX_PLAUSIBLE_KPH = 40;
  // Entry speeds catch a second artifact class the apex check misses: a
  // car arriving at 55% of its rival's entry speed (Silverstone 2025
  // Club: Leclerc 140 vs Piastri 255) was in traffic or avoiding an
  // incident — its apex may look plausible but the comparison is junk.
  const ENTRY_RATIO_PLAUSIBLE = 0.6;
  const allZoneDeltas = corners
    .map((c) => {
      const zoneA = a.zones.get(c);
      const zoneB = b.zones.get(c);
      const za = zoneA?.apex ?? null;
      const zb = zoneB?.apex ?? null;
      if (za === null || zb === null) return null;
      const ea = zoneA?.entry ?? null;
      const eb = zoneB?.entry ?? null;
      // An entry anomaly only corrupts the comparison when the apexes
      // actually diverge — near-identical apexes are a fair reading no
      // matter how the cars arrived (flagging those reads as arbitrary).
      const apexesDiverge = Math.abs(za - zb) > 8;
      const slowCars = [
        za < APEX_PLAUSIBLE_KPH || (apexesDiverge && ea !== null && eb !== null && ea < eb * ENTRY_RATIO_PLAUSIBLE) ? a.surname : null,
        zb < APEX_PLAUSIBLE_KPH || (apexesDiverge && ea !== null && eb !== null && eb < ea * ENTRY_RATIO_PLAUSIBLE) ? b.surname : null
      ].filter((s): s is string => s !== null);
      return { corner: c, delta: za - zb, suspect: slowCars.length > 0, slowCars };
    })
    .filter((z): z is { corner: string; delta: number; suspect: boolean; slowCars: string[] } => z !== null);
  if (allZoneDeltas.length === 0) return null;
  const suspectZones = allZoneDeltas.filter((z) => z.suspect);
  const zoneDeltas = allZoneDeltas.filter((z) => !z.suspect);
  if (zoneDeltas.length === 0) {
    // Every zone is artifact-grade — no honest signal exists.
    return null;
  }
  const meanZoneDelta = zoneDeltas.reduce((s, z) => s + z.delta, 0) / zoneDeltas.length;
  // Below ~2 km/h the lap-1 signal is inside sampling noise — there is no
  // brake-zone edge to foreshadow anything.
  const brakeSignalNeutral = Math.abs(meanZoneDelta) < 2;
  const brakeLeader = meanZoneDelta >= 0 ? a : b;
  const brakeTrailer = brakeLeader === a ? b : a;
  // The average can hide a split picture (leader takes 2 of 3 zones but
  // trails at the third) — name the zones the average-leader actually won
  // and the exception, so the prose matches the per-zone metric tiles.
  const leaderWon = zoneDeltas.filter((z) => (brakeLeader === a ? z.delta > 0 : z.delta < 0));
  const exceptions = zoneDeltas.filter((z) => (brakeLeader === a ? z.delta < 0 : z.delta > 0));
  const mixedPicture =
    exceptions.length > 0
      ? ` (${brakeLeader.surname} quicker at ${leaderWon.map((z) => z.corner).join(" and ")}; ${brakeTrailer.surname} quicker at ${exceptions.map((z) => z.corner).join(" and ")})`
      : "";

  // Race-pace signal: negative shared delta = a faster on shared green laps.
  const paceComparable = sharedPaceDelta !== null && (sharedGreenLaps ?? 0) >= 5;
  const paceLeader = paceComparable ? (sharedPaceDelta! <= 0 ? a : b) : null;
  const paceDelta = paceComparable ? Math.abs(sharedPaceDelta!) : null;
  const foreshadowed = paceLeader !== null && paceLeader === brakeLeader;

  let verdict: InsightFields["verdict"];
  if (paceComparable && paceLeader) {
    if (brakeSignalNeutral) {
      verdict = {
        label: "NO",
        summary: `The lap-1 brake zones were essentially even (${Math.abs(meanZoneDelta).toFixed(1)} km/h average apex delta — inside sampling noise), so there was no brake-zone deficit to foreshadow; ${paceLeader.surname} was ${paceDelta!.toFixed(3)}s/lap faster over their shared green laps`
      };
    } else {
      verdict = foreshadowed
        ? {
            label: "YES",
            color: "#22C55E",
            summary: `${brakeLeader.surname} carried ${Math.abs(meanZoneDelta).toFixed(1)} km/h more apex speed than ${brakeTrailer.surname} through the heavy brake zones on lap 1 AND was ${paceDelta!.toFixed(3)}s/lap faster over their shared green laps`
          }
        : {
            label: "NO",
            summary: `${brakeLeader.surname} led ${brakeTrailer.surname} in the lap-1 brake zones (+${Math.abs(meanZoneDelta).toFixed(1)} km/h apex) but ${paceLeader.surname} was ${paceDelta!.toFixed(3)}s/lap faster over their shared green laps — the lap-1 signal didn't carry`
          };
    }
  }

  // Name the quicker driver per zone — "A − B" signs make the reader do
  // the decoding and read as inconsistent next to the prose.
  const metrics: InsightFieldMetric[] = allZoneDeltas.slice(0, 3).map((z, i) => ({
    label: z.suspect ? `${z.corner} ⚠` : z.corner,
    value: `${z.delta >= 0 ? "+" : ""}${z.delta.toFixed(1)} km/h`,
    context: z.suspect
      ? `implausible lap-1 sample — excluded from the average`
      : `${z.delta === 0 ? "even" : `${(z.delta > 0 ? a : b).surname} quicker`} (${a.surname} − ${b.surname} apex, lap 1)`,
    emphasis: !z.suspect && i === 0
  }));

  // Name the excluded zone's nominal direction too — otherwise a reader
  // (or grader) sees its tile pointing one way and the headline the other
  // and reads a contradiction where there's an exclusion.
  const suspectNote = suspectZones.length
    ? ` ${suspectZones
        .map(
          (z) =>
            `${z.corner} shows an implausibly slow lap-1 sample for ${z.slowCars.length === 2 ? "both cars" : z.slowCars[0]} — its nominal ${Math.abs(z.delta).toFixed(1)} km/h in ${(z.delta > 0 ? a : b).surname}'s favour rests on that corrupted sample`
        )
        .join("; ")}, so it's excluded from the average (traffic, an incident, or a sampling gap on the opening lap).`
    : "";

  const takeaways = [
    `Heaviest brake zones by entry→apex speed drop: ${corners.join(", ")}`,
    brakeSignalNeutral
      ? `Lap-1 apex speeds essentially even (${Math.abs(meanZoneDelta).toFixed(1)} km/h average) across the usable zones`
      : `Lap-1 apex-speed edge: ${brakeLeader.surname} by ${Math.abs(meanZoneDelta).toFixed(1)} km/h on average over ${brakeTrailer.surname}${exceptions.length ? ` — split picture, ${brakeTrailer.surname} took ${exceptions.map((z) => z.corner).join(", ")}` : ""}`,
    ...(suspectZones.length
      ? [`${suspectZones.map((z) => z.corner).join(", ")}: implausibly slow lap-1 sample for ${suspectZones.some((z) => z.slowCars.length === 2) ? "both cars" : suspectZones.flatMap((z) => z.slowCars).join(", ")} — flagged on the card, excluded from the average`]
      : []),
    paceComparable
      ? `Race pace: ${paceLeader!.surname} faster by ${paceDelta!.toFixed(3)}s/lap — median per-lap difference over the ${sharedGreenLaps} laps both ran green, so safety-car and weather phases cancel out`
      : `Fewer than 5 shared green laps — race-pace comparison withheld`,
    `Speeds from telemetry corner samples (lap 1 only) — single-point snapshots per corner, not continuous traces`
  ];

  // With one usable zone there is no "average" — say exactly what the
  // reading rests on.
  const basis =
    zoneDeltas.length === 1
      ? `${Math.abs(meanZoneDelta).toFixed(1)} km/h at ${zoneDeltas[0].corner}, the only usable zone`
      : `${Math.abs(meanZoneDelta).toFixed(1)} km/h average across ${zoneDeltas.length === corners.length ? "the zones" : `the ${zoneDeltas.length} usable zones`}`;
  // F27 (golden-set audit 2026-07-02): don't hardcode "three" — a session
  // with corner data for only 2 heavy zones would read "three ... (Turn 1,
  // Turn 22)" with two listed.
  const zoneCountWord = corners.length === 3 ? "three" : corners.length === 2 ? "two" : String(corners.length);
  const answer =
    `Across the ${zoneCountWord} heaviest brake zones (${corners.join(", ")}) on lap 1 at ${venueYear || "this race"}, ` +
    (brakeSignalNeutral
      ? `${a.surname} and ${b.surname} were essentially even on apex speed (${basis}) — no meaningful brake-zone deficit existed.${suspectNote} `
      : `${brakeLeader.surname} carried more apex speed than ${brakeTrailer.surname} ${zoneDeltas.length === 1 ? "" : "on balance "}(${basis})${mixedPicture}.${suspectNote} `) +
    (paceComparable
      ? brakeSignalNeutral
        ? `With no brake-zone edge to carry forward, there was nothing to foreshadow; for the record, ${paceLeader!.surname} was faster by ${paceDelta!.toFixed(3)}s/lap as the median difference over the ${sharedGreenLaps} laps both drivers ran green. `
        : foreshadowed
          ? `That did foreshadow the race: ${paceLeader!.surname} was also faster where it counts, by ${paceDelta!.toFixed(3)}s/lap as the median difference over the ${sharedGreenLaps} laps both drivers ran green. `
          : `It did not foreshadow the race: ${paceLeader!.surname} was faster by ${paceDelta!.toFixed(3)}s/lap as the median difference over the ${sharedGreenLaps} laps both drivers ran green, despite trailing in the lap-1 brake zones. `
      : `Too few shared green laps to compare race pace fairly. `) +
    `Brake-zone speeds come from telemetry corner samples on lap 1 only.`;

  return {
    answer,
    insight: {
      title: `Brake Zones, Lap 1 — ${a.surname} vs ${b.surname}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", `${corners.length} heaviest zones`].filter(Boolean).join(" · "),
      verdict,
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Compare ${a.surname} and ${b.surname}'s full-race brake-zone speeds at ${venueYear || "this race"}`,
        `Where on the lap did the race-pace gap come from?`,
        `Did the brake-zone gap change as the fuel burned off?`
      ]
    }
  };
}
