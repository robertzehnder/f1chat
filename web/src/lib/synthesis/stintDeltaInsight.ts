import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic insight builder for the `driver_pair_stint_delta` template.
 *
 * Rows are one-per-shared-green-lap with per-stint aggregates repeated on
 * every row (see deterministicSql/stintDelta.ts). The builder answers the
 * "did the delta reverse / how did the gap evolve across stints" family
 * deterministically: verdict, per-stint metric tiles, takeaways.
 *
 * Honesty rules baked in:
 *   - delta = first-mentioned driver minus second (positive = A slower).
 *     Every number is phrased with the faster driver named, so the sign
 *     convention can't mislead.
 *   - A reversal is called on the stint AVERAGE; when the stint MEDIAN
 *     disagrees, the verdict and takeaways say so explicitly (a handful
 *     of outlier laps can flip an average without the typical lap
 *     changing) instead of presenting a clean flip.
 *   - Only shared green laps count, and that scoping is stated.
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
function fmtCompound(c: string | null): string | null {
  if (!c) return null;
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}
function signed(n: number, decimals = 3): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}`;
}

// Below this, a stint-average gap is inside lap-time noise for race pace;
// call it "effectively even" rather than handing one driver the stint.
const EVEN_THRESHOLD_S = 0.05;

type StintStat = {
  stint: number;
  avg: number;
  median: number | null;
  lapCount: number;
  aCompound: string | null;
  bCompound: string | null;
  firstLap: number;
  lastLap: number;
};

export type StintDeltaInsightResult = {
  answer: string;
  insight: InsightFields;
};

export function buildStintDeltaInsight(rows: Row[] | undefined): StintDeltaInsightResult | null {
  if (!rows || rows.length === 0) return null;
  const r0 = rows[0];
  if (!("delta_s" in r0) || !("stint_number" in r0) || !("driver_a_name" in r0)) return null;

  const aName = str(r0.driver_a_name) ?? "Driver A";
  const bName = str(r0.driver_b_name) ?? "Driver B";
  const aLast = lastName(aName);
  const bLast = lastName(bName);
  const venue = str(r0.location) ?? str(r0.country_name);
  const year = num(r0.year);
  const sessionName = str(r0.session_name) ?? "Race";
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  // Group rows into per-stint stats. The per-stint aggregates are already
  // on every row (computed in SQL, immune to row caps); read them off the
  // first row of each stint.
  const byStint = new Map<number, StintStat>();
  for (const r of rows) {
    const stint = num(r.stint_number);
    const lap = num(r.lap_number);
    if (stint === null || lap === null) continue;
    const existing = byStint.get(stint);
    if (existing) {
      existing.firstLap = Math.min(existing.firstLap, lap);
      existing.lastLap = Math.max(existing.lastLap, lap);
      continue;
    }
    const avg = num(r.stint_avg_delta);
    if (avg === null) continue;
    byStint.set(stint, {
      stint,
      avg,
      median: num(r.stint_median_delta),
      lapCount: num(r.stint_lap_count) ?? 0,
      aCompound: fmtCompound(str(r.a_compound)),
      bCompound: fmtCompound(str(r.b_compound)),
      firstLap: lap,
      lastLap: lap
    });
  }
  const stints = [...byStint.values()].sort((a, b) => a.stint - b.stint);
  if (stints.length === 0) return null;

  const sharedLapTotal = rows.filter((r) => num(r.lap_number) !== null).length;

  // Stints with no shared green laps (offset pit windows, wet phases,
  // traffic) make "across stints" questions partially unanswerable —
  // the answer must say so instead of silently narrating what survived.
  const presentStints = new Set(stints.map((s) => s.stint));
  const lastStintNumber = stints[stints.length - 1].stint;
  const missingStints: number[] = [];
  for (let n = 1; n <= lastStintNumber; n += 1) {
    if (!presentStints.has(n)) missingStints.push(n);
  }

  // Who is faster in a stint, by average. delta = A − B: positive = A slower.
  const fasterIn = (s: StintStat): string | null =>
    Math.abs(s.avg) < EVEN_THRESHOLD_S ? null : s.avg > 0 ? bLast : aLast;
  const describeStint = (s: StintStat): string => {
    const compound =
      s.aCompound && s.bCompound && s.aCompound !== s.bCompound
        ? `${s.aCompound} vs ${s.bCompound}`
        : s.aCompound ?? s.bCompound ?? "unknown compound";
    const leader = fasterIn(s);
    const gap = `${Math.abs(s.avg).toFixed(3)}s/lap`;
    return leader
      ? `Stint ${s.stint} (${compound}): ${leader} faster by ${gap} on average over ${s.lapCount} shared laps`
      : `Stint ${s.stint} (${compound}): effectively even (${signed(s.avg)}s/lap) over ${s.lapCount} shared laps`;
  };

  // Reversal verdict: final stint vs the stint immediately before it.
  const finalStint = stints[stints.length - 1];
  const prevStint = stints.length >= 2 ? stints[stints.length - 2] : null;
  const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);
  const avgReversed =
    prevStint !== null && sign(finalStint.avg) !== 0 && sign(prevStint.avg) !== 0 && sign(finalStint.avg) !== sign(prevStint.avg);
  // The median corroborates the average story only when it sits on the
  // same side as the average in BOTH stints. A flip that the median
  // doesn't reproduce (or reproduces in the opposite direction) means a
  // few outlier laps moved the average, not the typical lap.
  const medianCorroborates =
    prevStint !== null &&
    finalStint.median !== null &&
    prevStint.median !== null &&
    sign(finalStint.median) === sign(finalStint.avg) &&
    sign(prevStint.median) === sign(prevStint.avg);
  const marginalReversal = avgReversed && Math.abs(finalStint.avg) < EVEN_THRESHOLD_S;
  const outlierCaveat =
    avgReversed && !medianCorroborates && finalStint.median !== null && prevStint?.median !== null;

  let verdict: NonNullable<InsightFields["verdict"]> | undefined;
  if (prevStint !== null) {
    if (avgReversed) {
      const summaryParts = [
        `${signed(prevStint.avg)}s/lap in stint ${prevStint.stint} flipped to ${signed(finalStint.avg)}s/lap in stint ${finalStint.stint} (${aLast} − ${bLast}, by stint average)`
      ];
      if (marginalReversal) summaryParts.push("marginal — inside lap-time noise");
      if (outlierCaveat) summaryParts.push("median moved the other way, so outlier laps drive the flip");
      verdict = {
        label: "YES",
        color: outlierCaveat || marginalReversal ? "#F59E0B" : "#22C55E",
        summary: summaryParts.join(" — ")
      };
    } else {
      verdict = {
        label: "NO",
        summary: `No sign flip: ${signed(prevStint.avg)}s/lap in stint ${prevStint.stint} vs ${signed(finalStint.avg)}s/lap in stint ${finalStint.stint} (${aLast} − ${bLast}, by stint average)`
      };
    }
  }

  // --- Metrics: one tile per stint (most recent 4 if the race had more) ---
  const metricStints = stints.slice(-4);
  const metrics: InsightFieldMetric[] = metricStints.map((s) => {
    const compound =
      s.aCompound && s.bCompound && s.aCompound !== s.bCompound
        ? `${s.aCompound}/${s.bCompound}`
        : s.aCompound ?? s.bCompound ?? "?";
    // Leader first — the tile clips long context strings on the right, and
    // "who was faster" is the token that must survive truncation.
    return {
      label: `Stint ${s.stint} · ${compound}`,
      value: `${signed(s.avg)}s`,
      context: [
        fasterIn(s) ? `${fasterIn(s)} faster` : "even",
        s.median !== null ? `median ${signed(s.median)}s` : null,
        `${s.lapCount} laps`
      ]
        .filter(Boolean)
        .join(" · "),
      emphasis: s.stint === finalStint.stint
    };
  });

  // --- Takeaways ---
  const takeaways: string[] = stints.map(describeStint);
  if (outlierCaveat && prevStint) {
    takeaways.push(
      `Average flipped but the median did not (${signed(prevStint.median ?? 0)}s → ${signed(finalStint.median ?? 0)}s) — a few outlier laps drive the reversal`
    );
  }
  const offsetStint = stints.find((s) => s.aCompound && s.bCompound && s.aCompound !== s.bCompound);
  if (offsetStint) {
    takeaways.push(
      `Stint windows follow ${aLast}'s stints; in stint ${offsetStint.stint} ${bLast} was on ${offsetStint.bCompound} against ${aLast}'s ${offsetStint.aCompound}`
    );
  }
  const outlierLapCount = num(r0.outlier_lap_count) ?? 0;
  if (outlierLapCount > 0) {
    takeaways.push(
      `${outlierLapCount} shared lap${outlierLapCount === 1 ? "" : "s"} with a gap above 5s excluded (safety car, traffic, or off-track moments — not relative pace)`
    );
  }
  if (missingStints.length > 0) {
    takeaways.push(
      `Stint${missingStints.length === 1 ? "" : "s"} ${missingStints.join(", ")}: no shared green laps for this pair — not comparable`
    );
  }
  takeaways.push(`Shared green laps only — pit in/out, invalid, and unmatched laps are excluded`);

  // --- Answer body ---
  const sentences: string[] = [];
  if (missingStints.length > 0) {
    const missingList = missingStints.join(stints.length === 1 ? " and " : ", ");
    sentences.push(
      stints.length === 1
        ? `Did the deltas reverse? That can't be determined for ${aLast} vs ${bLast} at this race: only stint ${stints[0].stint} has shared green laps — stint${missingStints.length === 1 ? "" : "s"} ${missingList} ${missingStints.length === 1 ? "has" : "have"} none (offset pit windows or neutralized/wet laps), so there is no earlier stint to compare against. What the data does show:`
        : `A reversal across stint${missingStints.length === 1 ? "" : "s"} ${missingList} can't be assessed — ${missingStints.length === 1 ? "it has" : "they have"} no shared green laps for this pair; what CAN be compared is stints ${stints.map((s) => s.stint).join(" and ")}, and the verdict below covers exactly that.`
    );
  }
  sentences.push(
    `Per-lap delta is ${aLast} minus ${bLast} across ${sharedLapTotal} shared green laps (positive = ${bLast} faster).`
  );
  for (const s of stints) sentences.push(describeStint(s) + ".");
  if (prevStint !== null) {
    if (avgReversed) {
      let flip = `By stint average the delta reversed on stint ${finalStint.stint}: ${signed(prevStint.avg)}s/lap became ${signed(finalStint.avg)}s/lap`;
      if (marginalReversal) flip += `, though the final-stint margin is inside typical lap-time noise`;
      if (outlierCaveat) flip += `; the median did not flip, so the reversal rests on a few outlier laps rather than a typical-lap pace swing`;
      sentences.push(flip + ".");
    } else {
      sentences.push(
        `The delta did not reverse on stint ${finalStint.stint}: the stint average stayed on the same side (${signed(prevStint.avg)}s/lap → ${signed(finalStint.avg)}s/lap).`
      );
    }
  }
  const answer = sentences.join(" ");

  const title = venueYear
    ? `Stint Delta — ${aLast} vs ${bLast} · ${venueYear}`
    : `Stint Delta — ${aLast} vs ${bLast}`;
  const subtitle = [venueYear || venue, sessionName, `${stints.length} stints · ${sharedLapTotal} shared green laps`]
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
        `Which laps drove the stint ${finalStint.stint} swing between ${aLast} and ${bLast}?`,
        `Was there a safety car or traffic in stint ${finalStint.stint} at ${venueYear || "this race"}?`,
        `Compare ${aLast} and ${bLast}'s tyre degradation by stint at ${venueYear || "this race"}`
      ]
    }
  };
}
