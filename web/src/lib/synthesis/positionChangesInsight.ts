import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `race_position_changes`.
 *  Sparse (driver, lap, position) rows anchored at lap 0 = grid. The
 *  headline stats: biggest climber, biggest faller, winner's path. */

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

export type PositionChangesInsightResult = { answer: string; insight: InsightFields };

export function buildPositionChangesInsight(rows: Row[] | undefined): PositionChangesInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("position" in rows[0]) || !("total_laps" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  type D = { driverNumber: number; name: string; surname: string; grid: number | null; finish: number | null };
  const byDriver = new Map<number, D>();
  for (const r of rows) {
    const n = num(r.driver_number);
    if (n === null || byDriver.has(n)) continue;
    const name = str(r.driver_name) ?? `Driver #${n}`;
    byDriver.set(n, {
      driverNumber: n,
      name,
      surname: lastName(name),
      grid: num(r.grid_position),
      finish: num(r.finish_position)
    });
  }
  const drivers = [...byDriver.values()];
  const classified = drivers.filter((d) => d.grid !== null && d.finish !== null);
  if (classified.length === 0) return null;

  // F02 (golden-set audit 2026-07-02): core.grid_vs_finish.finish_position
  // is stale/duplicated when raw.session_result wasn't ingested — it falls
  // back to a driver's grid slot, producing no winner and duplicate
  // positions (São Paulo: "Verstappen climbed P19→P16" while his own trace
  // shows P19→P3). The per-lap `position` we already hold is the ground
  // truth; reconcile against it when finish_position is suspect.
  const lastTracePosition = (driver: number): number | null => {
    let best: { lap: number; pos: number } | null = null;
    for (const r of rows) {
      if (num(r.driver_number) !== driver) continue;
      const lap = num(r.lap_number);
      const pos = num(r.position);
      if (lap === null || pos === null) continue;
      if (!best || lap > best.lap) best = { lap, pos };
    }
    return best?.pos ?? null;
  };
  const finishes = classified.map((d) => d.finish);
  const hasDuplicateFinishes = new Set(finishes).size !== finishes.length;
  const noWinner = !classified.some((d) => d.finish === 1);
  const traceAvailable = rows.some((r) => num(r.position) !== null && num(r.lap_number) !== null);
  const finishSuspect = traceAvailable && (noWinner || hasDuplicateFinishes);
  let finishOverridden = false;
  if (finishSuspect) {
    for (const d of classified) {
      const traceFinish = lastTracePosition(d.driverNumber);
      if (traceFinish !== null) {
        d.finish = traceFinish;
        finishOverridden = true;
      }
    }
  }

  const withDelta = classified.map((d) => ({ ...d, delta: (d.grid ?? 0) - (d.finish ?? 0) }));
  const climber = [...withDelta].sort((a, b) => b.delta - a.delta)[0];
  const faller = [...withDelta].sort((a, b) => a.delta - b.delta)[0];
  const winner = classified.find((d) => d.finish === 1);
  const dnfs = drivers.filter((d) => d.finish === null);

  const metrics: InsightFieldMetric[] = [
    {
      label: "Biggest climber",
      value: `${climber.surname} +${climber.delta}`,
      context: `P${climber.grid} → P${climber.finish}`,
      emphasis: true
    },
    {
      label: "Biggest faller",
      value: `${faller.surname} ${faller.delta >= 0 ? "+" + faller.delta : faller.delta}`,
      context: `P${faller.grid} → P${faller.finish}`
    },
    {
      label: "Winner",
      value: winner ? winner.surname : "n/a",
      context: winner ? `from P${winner.grid}` : undefined
    }
  ];

  const takeaways = [
    `${climber.surname} made the race's best recovery: P${climber.grid} to P${climber.finish} (+${climber.delta})`,
    faller.delta < 0
      ? `${faller.surname} lost the most ground: P${faller.grid} to P${faller.finish} (${faller.delta})`
      : `Nobody classified lost positions overall`,
    winner ? `${winner.surname} won from P${winner.grid}` : ``,
    dnfs.length ? `${dnfs.length} car${dnfs.length === 1 ? "" : "s"} unclassified — their lines stop at their last recorded lap` : ``,
    finishOverridden
      ? `Official classification was unavailable for this session — finishing order is derived from each car's final recorded lap position`
      : ``,
    `The position feed logs changes only — flat segments mean held position, anchored at the grid on lap 0`
  ].filter(Boolean);

  // The pole-sitter's fate is the question most readers bring to this
  // chart — name it when pole didn't convert to the win.
  const poleSitter = classified.find((d) => d.grid === 1);
  const poleNote =
    poleSitter && poleSitter.finish !== 1
      ? `${poleSitter.surname} started from pole but finished P${poleSitter.finish}. `
      : ``;
  const answer =
    `Position changes at ${venueYear || "this race"}: ${climber.surname} was the biggest mover, climbing from P${climber.grid} to P${climber.finish}. ` +
    (faller.delta < 0 ? `${faller.surname} fell furthest (P${faller.grid} to P${faller.finish}). ` : ``) +
    (winner ? `${winner.surname} won from P${winner.grid}. ` : ``) +
    poleNote +
    `The chart traces every classified driver from their grid slot to the flag; the position feed logs changes only, so flat segments mean a held position.`;

  return {
    answer,
    insight: {
      title: `Position Changes${venueYear ? ` — ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", `${drivers.length} drivers`].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Show the race trace at ${venueYear || "this race"}`,
        `How did ${climber.surname} make up the places — strategy or pace?`,
        `How many on-track overtakes did ${venueYear || "this race"} produce?`
      ]
    }
  };
}
