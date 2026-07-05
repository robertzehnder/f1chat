import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `compound_degradation_curve`.
 *  Rows: (compound, tyre_age) median lap-time delta vs that compound's
 *  fresh-tyre baseline. Cliff detection per compound: first age where
 *  the median delta exceeds the cliff threshold and stays elevated. */

type Row = Record<string, unknown>;

const CLIFF_THRESHOLD_S = 0.6;

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
function fmtCompound(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

export type DegradationCurveInsightResult = { answer: string; insight: InsightFields };

export function buildDegradationCurveInsight(rows: Row[] | undefined): DegradationCurveInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("deg_delta_s" in rows[0]) || !("tyre_age" in rows[0]) || !("compound_name" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  type Curve = { compound: string; points: Array<{ age: number; delta: number; laps: number }> };
  const byCompound = new Map<string, Curve>();
  for (const r of rows) {
    const compound = str(r.compound_name);
    const age = num(r.tyre_age);
    const delta = num(r.deg_delta_s);
    const laps = num(r.lap_count) ?? 0;
    if (!compound || age === null || delta === null) continue;
    let c = byCompound.get(compound);
    if (!c) {
      c = { compound, points: [] };
      byCompound.set(compound, c);
    }
    c.points.push({ age, delta, laps });
  }
  const curves = [...byCompound.values()];
  if (curves.length === 0) return null;
  for (const c of curves) c.points.sort((a, b) => a.age - b.age);

  // F12 (golden-set audit 2026-07-02): a delta magnitude beyond plausible
  // tyre effects (>5s) means the fresh baseline itself was run under a
  // Safety Car — the whole curve is an artifact, not degradation. The SQL
  // now filters SC laps, but keep this as belt-and-braces: if it still
  // slips through, refuse the cliff/slope narrative outright.
  const DISRUPTION_THRESHOLD_S = 5;
  const disrupted = curves.some((c) => c.points.some((p) => Math.abs(p.delta) > DISRUPTION_THRESHOLD_S));
  if (disrupted) {
    return {
      answer:
        `Tyre-degradation curves for ${venueYear || "this session"} can't be trusted here: the delta magnitudes exceed plausible tyre effects, which means the fresh-tyre baseline laps were run under Safety Car or otherwise neutralized. Treat this race's degradation data as unreliable rather than reading a wear rate from it.`,
      insight: {
        title: `Tyre Degradation — ${venueYear || "Session"} (unreliable)`,
        subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", "baseline disrupted"].filter(Boolean).join(" · "),
        key_takeaways: [
          `Delta magnitudes exceed ±${DISRUPTION_THRESHOLD_S}s — implausible for tyre wear alone`,
          `The age ≤ 2 baseline laps were likely Safety-Car paced, so every later age reads artificially fast`,
          `No wear-rate or tyre-life figure is reported for this session`
        ]
      }
    };
  }

  // Per-compound: slope (delta at max sampled age / span) and cliff onset
  // (first age where delta > threshold AND the next sampled point stays
  // above 2/3 of it — sustained, not a one-off).
  const summaries = curves.map((c) => {
    const last = c.points[c.points.length - 1];
    const span = Math.max(last.age - c.points[0].age, 1);
    const ratePerLap = last.delta / span;
    // F21 (golden-set audit 2026-07-02): a cliff must be SUSTAINED, not a
    // single spike. Require the point to exceed the threshold AND the
    // majority of subsequent sampled points to stay above 2/3 of it (a lone
    // last point being high — Monaco age 67 — is not a cliff at age 1).
    let cliffAge: number | null = null;
    for (let i = 0; i < c.points.length; i += 1) {
      const p = c.points[i];
      if (p.delta <= CLIFF_THRESHOLD_S) continue;
      const after = c.points.slice(i + 1);
      const sustained =
        after.length === 0
          ? false
          : after.filter((q) => q.delta > CLIFF_THRESHOLD_S * 0.66).length >= after.length / 2;
      if (sustained || (after.length === 0 && i > 0)) {
        cliffAge = p.age;
        break;
      }
    }
    // A "dips below baseline" claim needs ≥2 sub-baseline points — a
    // single noisy lap isn't a dip, and the claim must carry the age it
    // happened at so it's checkable against the curve.
    const negatives = c.points.filter((p) => p.delta < -0.2);
    const minPoint = negatives.length >= 2 ? negatives.reduce((m, p) => (p.delta < m.delta ? p : m)) : null;
    return { compound: c.compound, maxAge: last.age, ratePerLap, cliffAge, lastDelta: last.delta, minPoint };
  });

  const metrics: InsightFieldMetric[] = summaries.slice(0, 3).map((s) => ({
    label: fmtCompound(s.compound),
    value: `${s.ratePerLap >= 0 ? "+" : ""}${s.ratePerLap.toFixed(3)}s/lap`,
    context: s.cliffAge !== null ? `cliff ~age ${s.cliffAge} · sampled to ${s.maxAge}` : `no cliff · sampled to age ${s.maxAge}`,
    emphasis: s.cliffAge !== null
  }));

  const thinCurves = curves.filter((c) => c.points.some((p) => p.laps < 4));
  const takeaways = [
    ...summaries.map((s) =>
      s.cliffAge !== null
        ? `${fmtCompound(s.compound)}: degrades ~${s.ratePerLap.toFixed(3)}s/lap with a cliff around tyre age ${s.cliffAge} (median ${s.lastDelta >= 0 ? "+" : ""}${s.lastDelta.toFixed(2)}s by age ${s.maxAge})`
        : s.ratePerLap < -0.005
          ? `${fmtCompound(s.compound)}: nets ${Math.abs(s.ratePerLap).toFixed(3)}s/lap faster with age (to age ${s.maxAge}) — fuel effect outweighs wear, not negative degradation`
          : `${fmtCompound(s.compound)}: ~${s.ratePerLap.toFixed(3)}s/lap, no sustained cliff in the sampled window (to age ${s.maxAge})`
    ),
    `Median lap time per tyre age vs each compound's own fresh-tyre (age ≤ 2) baseline — green valid laps only, NOT fuel-corrected`,
    ...(thinCurves.length
      ? [`Some ages have few laps behind them (fields thin out late in stints) — treat curve tails as indicative`]
      : [])
  ];

  const cliffed = summaries.filter((s) => s.cliffAge !== null);
  // No fuel correction is applied: at venues where fuel burn-off outweighs
  // tyre wear (street circuits especially), older tyres lap FASTER than
  // the heavy-fuel fresh baseline and slopes come out negative. Presenting
  // that as "degradation" without the explanation reads as a data error.
  const fuelDominated = summaries.filter((s) => s.ratePerLap < -0.005);
  const describeCompound = (s: (typeof summaries)[number]): string => {
    const endpoint = `${s.lastDelta >= 0 ? "+" : ""}${s.lastDelta.toFixed(2)}s by age ${s.maxAge}`;
    // An endpoint slope hides a dip-then-rise shape: many curves run
    // BELOW the fresh baseline mid-stint (fuel burn) before wear wins.
    const dips = s.minPoint !== null && s.lastDelta > 0;
    const shape = dips
      ? `, dipping ${Math.abs(s.minPoint!.delta).toFixed(2)}s below the fresh baseline around age ${s.minPoint!.age} (fuel burn) before wear takes over`
      : "";
    if (s.cliffAge !== null)
      return `${fmtCompound(s.compound)} crosses the cliff threshold around age ${s.cliffAge} and stays high (${endpoint})${shape}`;
    if (s.ratePerLap < -0.005)
      return `${fmtCompound(s.compound)} nets out ${Math.abs(s.ratePerLap).toFixed(3)}s/lap FASTER with age (${endpoint}) — fuel burn-off outweighs tyre wear here`;
    return `${fmtCompound(s.compound)} ends at ~${s.ratePerLap.toFixed(3)}s/lap net (${endpoint})${shape}, with no sustained cliff in the data`;
  };
  const answer =
    `Compound degradation at ${venueYear || "this session"}: ` +
    summaries.map(describeCompound).join("; ") +
    (fuelDominated.length
      ? `. These curves are NOT fuel-corrected — laps get quicker as the car lightens, and at this venue that effect exceeds tyre wear, so the net slopes understate (or invert) true compound degradation; compounds first used at the race start also get their fresh baseline set in heavy-fuel opening-lap traffic, which exaggerates how much "faster" their older laps look`
      : ``) +
    `. The per-lap rates are endpoint trend slopes through the median delta at each tyre age (individual laps scatter well above and below the trend); deltas are medians against each compound's fresh-tyre baseline — the median of age ≤ 2 laps, so the youngest points needn't read exactly 0.000 — making the curves comparable across compounds.` +
    (cliffed.length === 0
      ? ` No compound sustained the ${CLIFF_THRESHOLD_S}s cliff threshold in the sampled stint lengths` +
        (() => {
          const nearMiss = summaries.filter((s) => s.cliffAge === null && s.lastDelta >= CLIFF_THRESHOLD_S * 0.85);
          return nearMiss.length
            ? `, though ${nearMiss.map((s) => `${fmtCompound(s.compound)} came close (+${s.lastDelta.toFixed(2)}s by age ${s.maxAge})`).join(" and ")}.`
            : `.`;
        })()
      : ``);

  return {
    answer,
    insight: {
      title: `Tyre Degradation — ${venueYear || "Session"}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", `${curves.length} compounds`].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Which driver managed tyres best at ${venueYear || "this race"}?`,
        `Show the strategy split between the leaders at ${venueYear || "this race"}`,
        `Did anyone hit the cliff before their stop at ${venueYear || "this race"}?`
      ]
    }
  };
}
