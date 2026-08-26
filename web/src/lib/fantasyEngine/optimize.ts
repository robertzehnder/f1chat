import { BUDGET_CAP_M, ROSTER_CONSTRUCTORS, ROSTER_DRIVERS, type PriceTable, type Roster } from "./types";

/**
 * Roster optimizer (converged roadmap R4, single-round core).
 *
 * Exhaustive over C(drivers,5) × C(constructors,2) with a dominance prune:
 * fields are small (≤ ~24 drivers, ≤ 11 teams → ≤ ~2M combos) so Node
 * enumerates in well under a second with the prune. The DRS boost doubles
 * the best expected driver in the roster (that choice is independent of
 * the roster search).
 *
 * The rolling-horizon layer (squad value growth, chips) feeds ADJUSTED
 * expected points into `points` — this function only solves the knapsack.
 */

export type OptimizeInput = {
  driverPoints: Record<number, number>;
  constructorPoints: Record<string, number>;
  prices: PriceTable;
  budgetCap?: number;
  topN?: number;
};

export type RankedTeam = {
  roster: Roster;
  cost: number;
  expectedPoints: number;
  boostDriver: number;
};

export function optimizeTeams(input: OptimizeInput): RankedTeam[] {
  const cap = input.budgetCap ?? BUDGET_CAP_M;
  const topN = input.topN ?? 5;

  const drivers = Object.entries(input.driverPoints)
    .map(([num, pts]) => ({ num: Number(num), pts, price: input.prices.drivers[Number(num)] }))
    .filter((d) => d.price !== undefined);
  const constructors = Object.entries(input.constructorPoints)
    .map(([name, pts]) => ({ name, pts, price: input.prices.constructors[name] }))
    .filter((c) => c.price !== undefined);

  // Constructor pairs, cheapest-first cost for early budget pruning.
  const conPairs: Array<{ names: [string, string]; pts: number; price: number }> = [];
  for (let i = 0; i < constructors.length; i++) {
    for (let j = i + 1; j < constructors.length; j++) {
      conPairs.push({
        names: [constructors[i].name, constructors[j].name],
        pts: constructors[i].pts + constructors[j].pts,
        price: constructors[i].price + constructors[j].price
      });
    }
  }

  const best: RankedTeam[] = [];
  const consider = (team: RankedTeam) => {
    best.push(team);
    best.sort((a, b) => b.expectedPoints - a.expectedPoints);
    if (best.length > topN) best.pop();
  };

  const ds = drivers.slice().sort((a, b) => a.price - b.price);
  const n = ds.length;
  const combo: number[] = [];

  const minTailCost = (startIdx: number, need: number) => {
    let cost = 0;
    for (let k = 0; k < need; k++) cost += ds[startIdx + k]?.price ?? Number.POSITIVE_INFINITY;
    return cost;
  };

  const rec = (start: number, cost: number, pts: number, bestDriverPts: number) => {
    if (combo.length === ROSTER_DRIVERS) {
      for (const pair of conPairs) {
        const total = cost + pair.price;
        if (total > cap + 1e-9) continue;
        const expected = pts + bestDriverPts + pair.pts; // boost doubles best driver
        consider({
          roster: { drivers: combo.slice(), constructors: [...pair.names] },
          cost: total,
          expectedPoints: expected,
          boostDriver: combo.reduce((bd, d) => (input.driverPoints[d] > (input.driverPoints[bd] ?? -Infinity) ? d : bd), combo[0])
        });
      }
      return;
    }
    for (let i = start; i < n; i++) {
      const need = ROSTER_DRIVERS - combo.length - 1;
      const c = cost + ds[i].price + minTailCost(i + 1, need);
      if (c > cap + 1e-9) break; // sorted by price: no cheaper tail exists
      combo.push(ds[i].num);
      rec(i + 1, cost + ds[i].price, pts + ds[i].pts, Math.max(bestDriverPts, ds[i].pts));
      combo.pop();
    }
  };
  rec(0, 0, 0, Number.NEGATIVE_INFINITY);

  if (ROSTER_CONSTRUCTORS !== 2) throw new Error("optimizer assumes 2 constructors");
  return best;
}
