import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic insight builder for the `driver_pair_strategy_split`
 * template. Rows are one-per-driver-stint (driver A first); everything —
 * stop counts, compound sequences, pit laps, the split verdict — is
 * derived from the stint boundaries, so the answer is reproducible and
 * can't drift run-to-run.
 *
 * Honesty rules baked in:
 *   - "Split" means a structural difference: different stop counts or a
 *     different compound sequence. Same sequence with offset stop laps is
 *     NOT a split — the offset is reported instead.
 *   - Premise check: if the two drivers were NOT teammates that season
 *     (team_name differs), the card says so explicitly — "did Mercedes
 *     split strategies between Russell and Hamilton at Spa 2025" embeds a
 *     2024 assumption (Hamilton drove for Ferrari in 2025), and silently
 *     playing along validates the error.
 */

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

const COMPOUND_SHORT: Record<string, string> = {
  INTERMEDIATE: "Int",
  MEDIUM: "Med",
  SOFT: "Soft",
  HARD: "Hard",
  WET: "Wet"
};
function shortCompound(c: string | null): string {
  if (!c) return "?";
  return COMPOUND_SHORT[c.toUpperCase()] ?? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

type DriverStrategy = {
  driverNumber: number;
  name: string;
  surname: string;
  team: string | null;
  stints: Array<{ stint: number; compound: string; start: number; end: number; avgValidLap: number | null }>;
  sequence: string[];
  stops: number;
  pitLaps: number[];
  gridPosition: number | null;
  finishPosition: number | null;
};

export type StrategySplitInsightResult = {
  answer: string;
  insight: InsightFields;
};

export function buildStrategySplitInsight(rows: Row[] | undefined): StrategySplitInsightResult | null {
  if (!rows || rows.length === 0) return null;
  const r0 = rows[0];
  if (!("stint_number" in r0) || !("compound" in r0) || !("driver_name" in r0)) return null;

  // Group rows per driver, preserving row order (driver A sorts first).
  const byDriver = new Map<number, DriverStrategy>();
  for (const r of rows) {
    const driverNumber = num(r.driver_number);
    const stint = num(r.stint_number);
    const start = num(r.stint_start_lap);
    const end = num(r.stint_end_lap);
    const compound = str(r.compound);
    if (driverNumber === null || stint === null || start === null || end === null) continue;
    let entry = byDriver.get(driverNumber);
    if (!entry) {
      const name = str(r.driver_name) ?? `Driver #${driverNumber}`;
      entry = {
        driverNumber,
        name,
        surname: lastName(name),
        team: str(r.team_name),
        stints: [],
        sequence: [],
        stops: 0,
        pitLaps: [],
        gridPosition: num(r.grid_position),
        finishPosition: num(r.finish_position)
      };
      byDriver.set(driverNumber, entry);
    }
    if (!entry.stints.some((s) => s.stint === stint)) {
      entry.stints.push({ stint, compound: compound ?? "?", start, end, avgValidLap: num(r.avg_valid_lap) });
    }
  }
  const drivers = [...byDriver.values()];
  if (drivers.length !== 2) return null;

  // F19 (golden-set audit 2026-07-02): a late safety car / red flag records
  // same-compound 1–2-lap "stints" with no valid-lap time — these are tyre
  // records, not pit stops. Merge contiguous same-compound micro-fragments
  // BEFORE computing stops/sequence/verdict so "Sainz made 4 stops" (really
  // 1) can't ship as fact.
  let mergedFragmentCount = 0;
  const mergeFragments = (stints: DriverStrategy["stints"]): DriverStrategy["stints"] => {
    const sorted = [...stints].sort((a, b) => a.stint - b.stint);
    const merged: DriverStrategy["stints"] = [];
    for (const s of sorted) {
      const prev = merged[merged.length - 1];
      const isFragment =
        prev !== undefined &&
        s.compound === prev.compound &&
        s.end - s.start + 1 <= 2 &&
        s.avgValidLap === null &&
        s.start === prev.end + 1;
      if (isFragment) {
        prev.end = s.end;
        mergedFragmentCount += 1;
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  };
  for (const d of drivers) {
    d.stints = mergeFragments(d.stints);
    d.sequence = d.stints.map((s) => shortCompound(s.compound));
    d.stops = Math.max(d.stints.length - 1, 0);
    d.pitLaps = d.stints.slice(0, -1).map((s) => s.end);
  }
  const [a, b] = drivers;

  // F15 (golden-set audit 2026-07-02): a retirement records a short final
  // stint — a stop-count comparison after a DNF is meaningless (a crash
  // isn't a "0-stop strategy"). Detect it BEFORE the split verdict.
  const raceEndLap = Math.max(...drivers.flatMap((d) => d.stints.map((s) => s.end)), 0);
  const coverage = (d: DriverStrategy): number => {
    const last = Math.max(...d.stints.map((s) => s.end), 0);
    return raceEndLap > 0 ? last / raceEndLap : 1;
  };
  const dnfDrivers = drivers.filter((d) => coverage(d) < 0.9);

  const venue = str(r0.location) ?? str(r0.country_name);
  const year = num(r0.year);
  const sessionName = str(r0.session_name) ?? "Race";
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  // --- Split verdict: structural difference only ---
  const stopCountsDiffer = a.stops !== b.stops;
  const sequencesDiffer = a.sequence.join(">") !== b.sequence.join(">");
  const isSplit = stopCountsDiffer || sequencesDiffer;
  // Pit-timing offset between corresponding stops (same-structure case).
  const sharedStops = Math.min(a.pitLaps.length, b.pitLaps.length);
  const maxOffset = Array.from({ length: sharedStops }, (_, i) =>
    Math.abs(a.pitLaps[i] - b.pitLaps[i])
  ).reduce((m, v) => Math.max(m, v), 0);

  const seqText = (d: DriverStrategy) => d.sequence.join(" → ");
  const stopsText = (d: DriverStrategy) =>
    d.pitLaps.length ? `stop${d.pitLaps.length === 1 ? "" : "s"} lap ${d.pitLaps.join(", ")}` : "no stops";

  const dnfNames = dnfDrivers
    .map((d) => `${d.surname} (ended lap ${Math.max(...d.stints.map((s) => s.end), 0)} of ${raceEndLap})`)
    .join(" and ");
  const verdict: NonNullable<InsightFields["verdict"]> =
    dnfDrivers.length > 0
      ? {
          label: "NO",
          summary: `Can't compare strategies — ${dnfNames} did not run the full distance, so a stop-count comparison isn't meaningful after the retirement.`
        }
      : isSplit
        ? {
            label: "YES",
            color: "#22C55E",
            summary: stopCountsDiffer
              ? `${a.surname} ran ${a.stops} stop${a.stops === 1 ? "" : "s"} (${seqText(a)}) against ${b.surname}'s ${b.stops} (${seqText(b)})`
              : `Same stop count but different compounds: ${a.surname} ${seqText(a)} vs ${b.surname} ${seqText(b)}`
          }
        : {
            label: "NO",
            summary:
              `Both ran ${seqText(a)} with ${a.stops} stop${a.stops === 1 ? "" : "s"}` +
              (sharedStops > 0
                ? maxOffset <= 2
                  ? `, pitting within ${maxOffset} lap${maxOffset === 1 ? "" : "s"} of each other`
                  : `, though stop timing diverged by up to ${maxOffset} laps`
                : "")
          };

  // --- Premise check: not teammates ---
  const differentTeams = a.team !== null && b.team !== null && a.team !== b.team;

  // --- Metrics ---
  const metrics: InsightFieldMetric[] = [
    {
      label: `${a.surname} stops`,
      value: String(a.stops),
      context: `${seqText(a)} · ${stopsText(a)}`,
      emphasis: isSplit || undefined
    },
    {
      label: `${b.surname} stops`,
      value: String(b.stops),
      context: `${seqText(b)} · ${stopsText(b)}`,
      emphasis: isSplit || undefined
    }
  ];
  if (a.finishPosition !== null && b.finishPosition !== null) {
    metrics.push({
      label: "Finish",
      value: `P${a.finishPosition} · P${b.finishPosition}`,
      context: `${a.surname} · ${b.surname}` +
        (a.gridPosition !== null && b.gridPosition !== null
          ? ` (from P${a.gridPosition} · P${b.gridPosition})`
          : "")
    });
  }

  // --- Takeaways ---
  const takeaways: string[] = [
    `${a.surname}: ${seqText(a)} (${stopsText(a)})`,
    `${b.surname}: ${seqText(b)} (${stopsText(b)})`
  ];
  if (dnfDrivers.length > 0) {
    takeaways.push(
      `${dnfNames} did not complete the race — the stint bars end early and stop counts aren't comparable after a retirement`
    );
  } else if (isSplit) {
    takeaways.push(
      stopCountsDiffer
        ? `Structural split: ${Math.abs(a.stops - b.stops)} stop${Math.abs(a.stops - b.stops) === 1 ? "" : "s"} difference`
        : `Same stop count, different compound choice`
    );
  } else if (sharedStops > 0) {
    takeaways.push(
      maxOffset <= 2
        ? `Mirrored strategies — identical compounds, stops within ${maxOffset} lap${maxOffset === 1 ? "" : "s"}`
        : `Identical compounds, but stop timing diverged by up to ${maxOffset} laps`
    );
  }
  if (differentTeams) {
    takeaways.push(
      `Not teammates${year !== null ? ` in ${year}` : ""}: ${a.surname} drove for ${a.team}, ${b.surname} for ${b.team}`
    );
  }
  // F19: contiguous same-compound micro-fragments are merged above; note it.
  if (mergedFragmentCount > 0) {
    takeaways.push(
      `${mergedFragmentCount} same-compound stint fragment${mergedFragmentCount === 1 ? "" : "s"} (safety-car/red-flag tyre records with no valid lap) merged — not counted as pit stops`
    );
  }
  takeaways.push(`Stop counts and pit laps derived from stint boundaries in the timing data`);

  // --- Answer body ---
  const sentences: string[] = [];
  sentences.push(
    `${a.surname} ran ${seqText(a)} (${stopsText(a)}); ${b.surname} ran ${seqText(b)} (${stopsText(b)}).`
  );
  if (dnfDrivers.length > 0) {
    sentences.push(
      `This isn't a clean strategy comparison: ${dnfNames} retired before the finish, so the shorter stint history reflects a DNF, not a deliberate one-stop or no-stop call.`
    );
  } else if (isSplit) {
    sentences.push(
      stopCountsDiffer
        ? `That is a genuine strategy split: ${a.surname} made ${a.stops} stop${a.stops === 1 ? "" : "s"} to ${b.surname}'s ${b.stops}.`
        : `That is a strategy split on compound choice, with the same number of stops.`
    );
  } else {
    sentences.push(
      `The strategies were not split: same compound sequence and stop count` +
        (sharedStops > 0
          ? maxOffset <= 2
            ? `, with stops just ${maxOffset === 0 ? "the same lap" : `${maxOffset} lap${maxOffset === 1 ? "" : "s"} apart`}.`
            : `, though the stop timing diverged by up to ${maxOffset} laps.`
          : ".")
    );
  }
  if (differentTeams) {
    sentences.push(
      `Note: ${a.surname} and ${b.surname} were not teammates${year !== null ? ` in ${year}` : ""} — ${a.surname} drove for ${a.team} and ${b.surname} for ${b.team} — so this was not a single team splitting its cars.`
    );
  }
  const answer = sentences.join(" ");

  const sameTeamLabel = !differentTeams && a.team ? `${a.team} ` : "";
  const title = isSplit
    ? `${sameTeamLabel}Strategy Split — ${a.surname} vs ${b.surname}${venueYear ? ` · ${venueYear}` : ""}`
    : `${sameTeamLabel}Strategies Compared — ${a.surname} vs ${b.surname}${venueYear ? ` · ${venueYear}` : ""}`;
  const subtitle = [venueYear || venue, sessionName, `${a.stints.length} + ${b.stints.length} stints`]
    .filter(Boolean)
    .join(" · ");

  return {
    answer,
    insight: {
      title,
      subtitle,
      verdict,
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Compare ${a.surname} and ${b.surname}'s stint pace at ${venueYear || "this race"}`,
        `Did the pit-stop timing cost ${b.surname} track position at ${venueYear || "this race"}?`,
        `Show the undercut window between ${a.surname} and ${b.surname}`
      ]
    }
  };
}
