/**
 * fantasyEngine — season-pinned mechanics for the official F1 Fantasy game.
 *
 * Converged-roadmap R2: every backtest, regret computation, and optimizer
 * state transition goes through THIS module so historical decisions are
 * executable-by-construction. Scoring VALUES live in the database
 * (core.fantasy_scoring_rules, migration 057); this module encodes the
 * MECHANICS: roster shape, budget, transfer accounting, chip state
 * machines, and round scoring composition over ledger components.
 */

export type Season = 2025 | 2026;

export type ChipName =
  | "drs_boost" // per-round, not a season chip: 2x one driver, every round
  | "extra_drs" // 3x one driver, once per season
  | "wildcard" // unlimited transfers, budget still applies
  | "limitless" // unlimited transfers, no budget cap for the round
  | "final_fix" // one transfer between quali and race
  | "no_negative" // negative scoring components clamped to zero
  | "autopilot"; // DRS boost auto-assigned to highest scorer

export const SEASON_CHIPS: readonly ChipName[] = [
  "extra_drs",
  "wildcard",
  "limitless",
  "final_fix",
  "no_negative",
  "autopilot"
];

export type Roster = {
  /** exactly 5 unique driver numbers */
  drivers: number[];
  /** exactly 2 unique canonical team names */
  constructors: string[];
};

export type PriceTable = {
  /** driver number → $M */
  drivers: Record<number, number>;
  /** team name → $M */
  constructors: Record<string, number>;
};

export type TeamState = {
  season: Season;
  roster: Roster;
  /** remaining budget headroom in $M (cap − roster cost at purchase prices). */
  budget: number;
  /** season chips not yet consumed. */
  chipsAvailable: ChipName[];
};

export type RoundDecision = {
  transfersIn: { drivers: number[]; constructors: string[] };
  transfersOut: { drivers: number[]; constructors: string[] };
  /** driver number receiving DRS boost (2x), or extra_drs target (3x). */
  boostDriver: number | null;
  chip: ChipName | null;
};

export type LedgerComponent = {
  entityType: "driver" | "constructor";
  entityKey: string;
  component: string;
  points: number;
};

export type RoundScore = {
  driverPoints: Record<number, number>;
  constructorPoints: Record<string, number>;
  boostBonus: number;
  transferPenalty: number;
  total: number;
};

export const BUDGET_CAP_M = 100;
export const ROSTER_DRIVERS = 5;
export const ROSTER_CONSTRUCTORS = 2;
export const FREE_TRANSFERS = 2;
export const TRANSFER_PENALTY = -10;
