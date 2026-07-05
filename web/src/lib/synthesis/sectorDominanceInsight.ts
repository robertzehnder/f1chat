import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_sector_dominance`.
 *  Three rows (S1/S2/S3) with each driver's best valid sector TIME —
 *  reliable timing data, so no artifact guards needed. The track map /
 *  strip is attached client-side by the track_heatmap detector. */

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

export type SectorDominanceInsightResult = { answer: string; insight: InsightFields };

export function buildSectorDominanceInsight(rows: Row[] | undefined): SectorDominanceInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("a_best" in rows[0]) || !("leader" in rows[0]) || !("name" in rows[0])) return null;

  const aName = str(rows[0].driver_a) ?? "Driver A";
  const bName = str(rows[0].driver_b) ?? "Driver B";
  const aLast = lastName(aName);
  const bLast = lastName(bName);
  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const sessionName = str(rows[0].session_name) ?? "Race";
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const sectors = rows
    .map((r) => ({
      name: str(r.name) ?? "Sector",
      leader: str(r.leader) ?? "",
      delta: num(r.delta_ms) ?? 0,
      aBest: num(r.a_best),
      bBest: num(r.b_best)
    }))
    .filter((s) => s.leader);
  if (sectors.length === 0) return null;

  const aWins = sectors.filter((s) => s.leader === aName);
  const bWins = sectors.filter((s) => s.leader === bName);
  // Positive = A ahead on the ideal lap (sum of each driver's best sectors).
  const aAdvantage = sectors.reduce((sum, s) => sum + (s.leader === aName ? s.delta : -s.delta), 0);
  const lapLeader = aAdvantage >= 0 ? aLast : bLast;
  const idealGap = Math.abs(aAdvantage);

  // Leader in the LABEL, delta alone as the value — tile values clip
  // beyond ~10 chars. Context uses 3-letter codes so two full times fit
  // the tile width ("HAM 28.909 · VER 28.940").
  const code = (name: string) => lastName(name).slice(0, 3).toUpperCase();
  const metrics: InsightFieldMetric[] = sectors.map((s) => ({
    label: `${s.name} · ${lastName(s.leader)}`,
    value: `+${s.delta.toFixed(3)}s`,
    context: `${code(aName)} ${s.aBest?.toFixed(3) ?? "?"} · ${code(bName)} ${s.bBest?.toFixed(3) ?? "?"}`,
    emphasis: s.delta === Math.max(...sectors.map((x) => x.delta))
  }));

  const takeaways = [
    ...sectors.map(
      (s) => `${s.name}: ${lastName(s.leader)} faster by ${s.delta.toFixed(3)}s (best valid sector times)`
    ),
    `Ideal-lap gap (best sectors summed): ${lapLeader} by ${idealGap.toFixed(3)}s — theoretical, the sectors weren't set simultaneously`,
    `Sector times from official timing data — best valid green-lap sector per driver`
  ];

  const answer =
    `By best valid sector times at ${venueYear || "this session"}, ` +
    sectors
      .map((s) => `${lastName(s.leader)} owned ${s.name} (+${s.delta.toFixed(3)}s)`)
      .join(", ") +
    `. Summing each driver's best sectors, ${lapLeader} holds the ideal-lap edge by ${idealGap.toFixed(3)}s — a theoretical construct, since the best sectors were not necessarily set on the same lap or run. ` +
    `The map colors each sector by its faster driver, with boundaries placed from the reference lap's timing.`;

  return {
    answer,
    insight: {
      title: `Track Dominance — ${aLast} vs ${bLast}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, sessionName, `${aWins.length} + ${bWins.length} of ${sectors.length} sectors`]
        .filter(Boolean)
        .join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Break ${sectors.find((s) => s.delta === Math.max(...sectors.map((x) => x.delta)))?.name ?? "the biggest sector"} down by minisector for ${aLast} vs ${bLast}`,
        `Compare ${aLast} and ${bLast}'s speed-trap numbers at ${venueYear || "this race"}`,
        `Was the sector edge consistent across the race or only on the best lap?`
      ]
    }
  };
}
