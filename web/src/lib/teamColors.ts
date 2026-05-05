// Phase 26 UI: F1 team / driver color registry.
//
// Source: F1.com 2025 official team palette (cross-referenced against
// each constructor's launch livery announcement). Hex values are the
// primary brand color; `accent` is a secondary used for second-driver
// distinction when both drivers from the same team appear in a chart.
//
// driverNumber → team mapping reflects the 2025 grid (post-mid-season
// driver-swaps included where relevant — Lawson/Tsunoda RB↔Red Bull;
// Bortoleto / Antonelli / Hadjar rookies; Hamilton at Ferrari; Sainz
// at Williams).
//
// When a driver_number is not in the map (rookie not yet driven, sub
// driver, etc.), `getDriverColor()` falls back to a neutral gray with
// a deterministic hash-based hue so the same driver always shows the
// same color across renders.

export type TeamKey =
  | "red_bull"
  | "ferrari"
  | "mclaren"
  | "mercedes"
  | "aston_martin"
  | "alpine"
  | "williams"
  | "rb"
  | "haas"
  | "kick_sauber";

export type TeamPalette = {
  /** Display name as shown in F1 broadcasts. */
  team: string;
  /** Primary brand color — used as the main bar color. */
  primary: string;
  /** Slightly tinted accent — used for the second driver of the team
   *  when the same team has 2 drivers in a chart. */
  accent: string;
};

export const TEAM_COLORS: Record<TeamKey, TeamPalette> = {
  red_bull:     { team: "Red Bull Racing", primary: "#1E41FF", accent: "#4781D7" },
  ferrari:      { team: "Ferrari",         primary: "#DC0000", accent: "#FF6B6B" },
  mclaren:      { team: "McLaren",         primary: "#FF8000", accent: "#FFB266" },
  mercedes:     { team: "Mercedes",        primary: "#27F4D2", accent: "#7CF7E2" },
  aston_martin: { team: "Aston Martin",    primary: "#229971", accent: "#5BB89A" },
  alpine:       { team: "Alpine",          primary: "#0093CC", accent: "#FF87BC" },
  williams:     { team: "Williams",        primary: "#1868DB", accent: "#5C9BFF" },
  rb:           { team: "RB",              primary: "#6692FF", accent: "#9CB7FF" },
  haas:         { team: "Haas",            primary: "#B6BABD", accent: "#E0E2E5" },
  kick_sauber:  { team: "Kick Sauber",     primary: "#52E252", accent: "#A0EFA0" }
};

/** driver_number → team_key for the 2025 season (includes mid-season swaps). */
export const DRIVER_TEAM: Record<number, TeamKey> = {
  // Red Bull
  1:  "red_bull",      // Max Verstappen
  22: "red_bull",      // Yuki Tsunoda (post-RB swap)
  // Ferrari
  16: "ferrari",       // Charles Leclerc
  44: "ferrari",       // Lewis Hamilton (2025 move)
  // McLaren
  4:  "mclaren",       // Lando Norris
  81: "mclaren",       // Oscar Piastri
  // Mercedes
  63: "mercedes",      // George Russell
  12: "mercedes",      // Andrea Kimi Antonelli (rookie)
  // Aston Martin
  14: "aston_martin",  // Fernando Alonso
  18: "aston_martin",  // Lance Stroll
  // Alpine
  10: "alpine",        // Pierre Gasly
  7:  "alpine",        // Jack Doohan (early-season)
  43: "alpine",        // Franco Colapinto (mid-season replacement)
  // Williams
  23: "williams",      // Alexander Albon
  55: "williams",      // Carlos Sainz (2025 move)
  // RB (Visa Cash App RB)
  30: "rb",            // Liam Lawson (post-RB swap)
  6:  "rb",            // Isack Hadjar (rookie)
  // Haas
  31: "haas",          // Esteban Ocon
  87: "haas",          // Oliver Bearman
  // Kick Sauber
  27: "kick_sauber",   // Nico Hülkenberg
  5:  "kick_sauber"    // Gabriel Bortoleto (rookie)
};

/** Resolve a driver_number to its 2025 team palette, or a stable
 *  fallback if the driver isn't in the registry. */
export function getDriverPalette(driverNumber: number | string | null | undefined): TeamPalette {
  const num = typeof driverNumber === "string" ? Number(driverNumber) : driverNumber ?? NaN;
  if (Number.isFinite(num)) {
    const teamKey = DRIVER_TEAM[num as number];
    if (teamKey) return TEAM_COLORS[teamKey];
  }
  // Fallback: deterministic hash-based gray-blue (same driver always
  // gets the same shade across renders).
  const seed = Number.isFinite(num) ? Math.abs(num as number) : 0;
  const hue = (seed * 47) % 360;
  return {
    team: "Unknown",
    primary: `hsl(${hue}, 18%, 55%)`,
    accent: `hsl(${hue}, 18%, 70%)`
  };
}

/** Convenience for the primary color only. */
export function getDriverColor(driverNumber: number | string | null | undefined): string {
  return getDriverPalette(driverNumber).primary;
}

/** Resolve a team key (string match against display name OR raw key)
 *  to the palette. Lenient: case-insensitive, ignores spaces /
 *  underscores / hyphens. */
export function getTeamPalette(teamName: string | null | undefined): TeamPalette | null {
  if (!teamName) return null;
  const normalized = teamName.toLowerCase().replace(/[\s_-]+/g, "");
  for (const [key, palette] of Object.entries(TEAM_COLORS)) {
    if (key.replace(/_/g, "") === normalized) return palette;
    if (palette.team.toLowerCase().replace(/\s+/g, "") === normalized) return palette;
  }
  // Common aliases
  if (normalized.includes("redbull")) return TEAM_COLORS.red_bull;
  if (normalized.includes("kick") || normalized.includes("sauber")) return TEAM_COLORS.kick_sauber;
  if (normalized.includes("vcarb") || normalized === "rb") return TEAM_COLORS.rb;
  return null;
}
