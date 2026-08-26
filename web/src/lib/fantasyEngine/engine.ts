import {
  BUDGET_CAP_M,
  FREE_TRANSFERS,
  ROSTER_CONSTRUCTORS,
  ROSTER_DRIVERS,
  SEASON_CHIPS,
  TRANSFER_PENALTY,
  type ChipName,
  type LedgerComponent,
  type PriceTable,
  type RoundDecision,
  type RoundScore,
  type Roster,
  type Season,
  type TeamState
} from "./types";

export type LegalityResult = { legal: true } | { legal: false; reasons: string[] };

/** Roster shape + budget legality at the given prices. */
export function validateRoster(
  roster: Roster,
  prices: PriceTable,
  opts?: { budgetCap?: number }
): LegalityResult {
  const reasons: string[] = [];
  const cap = opts?.budgetCap ?? BUDGET_CAP_M;
  if (roster.drivers.length !== ROSTER_DRIVERS) {
    reasons.push(`roster needs exactly ${ROSTER_DRIVERS} drivers (got ${roster.drivers.length})`);
  }
  if (new Set(roster.drivers).size !== roster.drivers.length) {
    reasons.push("duplicate driver in roster");
  }
  if (roster.constructors.length !== ROSTER_CONSTRUCTORS) {
    reasons.push(`roster needs exactly ${ROSTER_CONSTRUCTORS} constructors (got ${roster.constructors.length})`);
  }
  if (new Set(roster.constructors).size !== roster.constructors.length) {
    reasons.push("duplicate constructor in roster");
  }
  let cost = 0;
  for (const d of roster.drivers) {
    const p = prices.drivers[d];
    if (p === undefined) reasons.push(`no price for driver ${d}`);
    else cost += p;
  }
  for (const c of roster.constructors) {
    const p = prices.constructors[c];
    if (p === undefined) reasons.push(`no price for constructor ${c}`);
    else cost += p;
  }
  if (reasons.length === 0 && cost > cap + 1e-9) {
    reasons.push(`roster cost $${cost.toFixed(1)}M exceeds cap $${cap}M`);
  }
  return reasons.length ? { legal: false, reasons } : { legal: true };
}

/**
 * Transfer accounting for a round. 2026 counts the NET roster change from
 * the previous round; 2025 counted every swap. Wildcard/limitless make
 * transfers free; limitless also suspends the budget cap for this round.
 */
export function applyRoundDecision(
  state: TeamState,
  decision: RoundDecision,
  prices: PriceTable
): { next: TeamState; transferPenalty: number } | { error: string } {
  const { roster } = state;
  const chip = decision.chip;
  if (chip && chip !== "drs_boost" && !state.chipsAvailable.includes(chip)) {
    return { error: `chip ${chip} already used or unavailable` };
  }

  const nextDrivers = roster.drivers
    .filter((d) => !decision.transfersOut.drivers.includes(d))
    .concat(decision.transfersIn.drivers);
  const nextConstructors = roster.constructors
    .filter((c) => !decision.transfersOut.constructors.includes(c))
    .concat(decision.transfersIn.constructors);
  const nextRoster: Roster = { drivers: nextDrivers, constructors: nextConstructors };

  const legality = validateRoster(nextRoster, prices, {
    budgetCap: chip === "limitless" ? Number.POSITIVE_INFINITY : BUDGET_CAP_M
  });
  if (!legality.legal) {
    return { error: legality.reasons.join("; ") };
  }

  const swapCount =
    decision.transfersIn.drivers.length +
    decision.transfersIn.constructors.length;
  // 2026 nets the change; a swap out+in of the same asset cancels.
  const netCount =
    state.season >= 2026
      ? nextRoster.drivers.filter((d) => !roster.drivers.includes(d)).length +
        nextRoster.constructors.filter((c) => !roster.constructors.includes(c)).length
      : swapCount;
  const freeTransfers = chip === "wildcard" || chip === "limitless" ? Number.POSITIVE_INFINITY : FREE_TRANSFERS;
  const chargeable = Math.max(0, netCount - (Number.isFinite(freeTransfers) ? freeTransfers : netCount));
  // `0 * -10` is -0 in JS; normalize so equality checks behave.
  const transferPenalty = chargeable === 0 ? 0 : chargeable * TRANSFER_PENALTY;

  const chipsAvailable =
    chip && chip !== "drs_boost"
      ? state.chipsAvailable.filter((c) => c !== chip)
      : state.chipsAvailable;

  return {
    next: { ...state, roster: nextRoster, chipsAvailable },
    transferPenalty
  };
}

/**
 * Score a locked team for one round from ledger components (the DB ledger's
 * rows for that meeting). Composition rules:
 *  - constructor totals = sum of BOTH its drivers' points + constructor rows
 *    (the ledger stores driver components once; we aggregate here for the
 *    two rostered constructors using the driver→team mapping provided).
 *  - DRS boost doubles (or extra_drs triples) ONE rostered driver.
 *  - no_negative clamps each negative COMPONENT to zero before summing.
 */
export function scoreRound(args: {
  state: TeamState;
  decision: Pick<RoundDecision, "boostDriver" | "chip">;
  components: LedgerComponent[];
  driverTeams: Record<number, string>;
  transferPenalty?: number;
}): RoundScore {
  const { state, decision, components, driverTeams } = args;
  const noNegative = decision.chip === "no_negative";
  const clamp = (p: number) => (noNegative ? Math.max(0, p) : p);

  const driverPoints: Record<number, number> = {};
  for (const d of state.roster.drivers) driverPoints[d] = 0;
  const constructorPoints: Record<string, number> = {};
  for (const c of state.roster.constructors) constructorPoints[c] = 0;

  for (const comp of components) {
    if (comp.entityType === "driver") {
      const num = Number(comp.entityKey);
      if (num in driverPoints) {
        driverPoints[num] += clamp(comp.points);
      }
      const team = driverTeams[num];
      if (team && team in constructorPoints) {
        constructorPoints[team] += clamp(comp.points);
      }
    } else if (comp.entityKey in constructorPoints) {
      constructorPoints[comp.entityKey] += clamp(comp.points);
    }
  }

  let boostBonus = 0;
  if (decision.boostDriver !== null && decision.boostDriver in driverPoints) {
    const mult = decision.chip === "extra_drs" ? 2 : 1; // base already counted once
    boostBonus = driverPoints[decision.boostDriver] * mult;
  }

  const transferPenalty = args.transferPenalty ?? 0;
  const total =
    Object.values(driverPoints).reduce((a, b) => a + b, 0) +
    Object.values(constructorPoints).reduce((a, b) => a + b, 0) +
    boostBonus +
    transferPenalty;

  return { driverPoints, constructorPoints, boostBonus, transferPenalty, total };
}

export function freshSeasonState(season: Season, roster: Roster, prices: PriceTable): TeamState | { error: string } {
  const legality = validateRoster(roster, prices);
  if (!legality.legal) return { error: legality.reasons.join("; ") };
  const cost =
    roster.drivers.reduce((a, d) => a + prices.drivers[d], 0) +
    roster.constructors.reduce((a, c) => a + prices.constructors[c], 0);
  return {
    season,
    roster,
    budget: BUDGET_CAP_M - cost,
    chipsAvailable: [...SEASON_CHIPS]
  };
}
