export const F1_TEAM_COLORS: Record<string, string> = {
  "Red Bull Racing": "#3671C6",
  "Ferrari": "#E8002D",
  "Mercedes": "#27F4D2",
  "McLaren": "#FF8000",
  "Aston Martin": "#229971",
  "Alpine": "#FF87BC",
  "Williams": "#64C4FF",
  "RB": "#6692FF",
  "Sauber": "#52E252",
  "Haas": "#B6BABD",
  // Fallback
  "default": "#888888"
}

// Secondary / accent color per team, for head-to-head TEAMMATE comparisons.
// Team color alone fails when both drivers on screen are the same team (two
// identical Ferrari-red lines). The second driver gets a genuinely distinct
// HUE drawn from the team's own 2025 livery accent — not a lightened shade,
// which reads as "the same color" on overlapping traces. Only same-team pairs
// are ever shown together, so cross-team collisions don't matter here.
// Sourced from 2025 constructor liveries (teamcolorcodes / f1-constructors).
export const F1_TEAM_SECONDARY_COLORS: Record<string, string> = {
  "Red Bull Racing": "#FF1801", // navy → Red Bull red
  "Ferrari": "#FFEB00",         // red → Ferrari yellow
  "Mercedes": "#C0C0C0",        // petronas teal → Silver Arrow
  "McLaren": "#00B4E6",         // papaya → speedmark cyan
  "Aston Martin": "#CEDC00",    // racing green → lime accent
  "Alpine": "#2293D1",          // pink → Alpine blue (two-tone livery)
  "Williams": "#E4E4E4",        // light blue → white
  "RB": "#F0323C",              // blue → red accent
  "Sauber": "#B0BEC5",          // Kick green → silver (black reads as void on dark UI)
  "Haas": "#E6002B",            // silver → red
  "default": "#D0D0D0"
}

// Primary-hex → secondary-hex, so we can resolve the accent from whatever the
// robust getTeamColor() lookup already produced. This sidesteps re-doing name
// resolution (OpenF1 uppercase / last-name-only labels) in a second place.
const SECONDARY_BY_PRIMARY: Record<string, string> = Object.fromEntries(
  Object.keys(F1_TEAM_COLORS)
    .filter((team) => team !== "default")
    .map((team) => [F1_TEAM_COLORS[team], F1_TEAM_SECONDARY_COLORS[team] ?? F1_TEAM_SECONDARY_COLORS.default])
)

// The team accent for a driver/team. Resolves the team the SAME way getTeamColor
// does (exact key, driver→team, title-cased, last-name) by mapping its primary
// hex to the secondary — so "Max VERSTAPPEN" / "VERSTAPPEN" resolve correctly,
// not to default gray.
export function getTeamSecondaryColor(teamOrDriver: string): string {
  if (!teamOrDriver) return F1_TEAM_SECONDARY_COLORS.default
  if (F1_TEAM_SECONDARY_COLORS[teamOrDriver]) return F1_TEAM_SECONDARY_COLORS[teamOrDriver]
  return SECONDARY_BY_PRIMARY[getTeamColor(teamOrDriver)] ?? F1_TEAM_SECONDARY_COLORS.default
}

// 2025 lineup. Some seats changed hands mid-season:
//   - Tsunoda moved RB → Red Bull (after Lawson swap)
//   - Lawson moved Red Bull → RB (demoted)
//   - Colapinto replaced Doohan at Alpine from Imola onwards
// All four are mapped here so historical-data lookups across the
// season still resolve to the correct team color at the time the
// driver was racing.
export const F1_DRIVER_TEAMS: Record<string, string> = {
  "Max Verstappen": "Red Bull Racing",
  "Yuki Tsunoda": "Red Bull Racing",
  "Sergio Perez": "Red Bull Racing",
  "Lewis Hamilton": "Ferrari",
  "Charles Leclerc": "Ferrari",
  "George Russell": "Mercedes",
  "Andrea Kimi Antonelli": "Mercedes",
  "Kimi Antonelli": "Mercedes",
  "Lando Norris": "McLaren",
  "Oscar Piastri": "McLaren",
  "Fernando Alonso": "Aston Martin",
  "Lance Stroll": "Aston Martin",
  "Pierre Gasly": "Alpine",
  "Jack Doohan": "Alpine",
  "Franco Colapinto": "Alpine",
  "Alex Albon": "Williams",
  "Carlos Sainz": "Williams",
  "Isack Hadjar": "RB",
  "Liam Lawson": "RB",
  "Nico Hulkenberg": "Sauber",
  "Gabriel Bortoleto": "Sauber",
  "Esteban Ocon": "Haas",
  "Oliver Bearman": "Haas",
}

// OpenF1 returns driver_name with the last name uppercased ("Max VERSTAPPEN"),
// while our maps key on proper-case ("Max Verstappen"). Title-case each
// whitespace-separated token so lookups succeed regardless of input casing.
function titleCaseName(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function getTeamColor(teamOrDriver: string): string {
  if (!teamOrDriver) return F1_TEAM_COLORS.default;

  // 1. Direct team-name match
  if (F1_TEAM_COLORS[teamOrDriver]) return F1_TEAM_COLORS[teamOrDriver];

  // 2. Direct full-name driver match
  const directTeam = F1_DRIVER_TEAMS[teamOrDriver];
  if (directTeam && F1_TEAM_COLORS[directTeam]) return F1_TEAM_COLORS[directTeam];

  // 3. Title-cased full-name driver match ("Max VERSTAPPEN" → "Max Verstappen")
  const titled = titleCaseName(teamOrDriver);
  const titledTeam = F1_DRIVER_TEAMS[titled];
  if (titledTeam && F1_TEAM_COLORS[titledTeam]) return F1_TEAM_COLORS[titledTeam];

  // 4. Last-name match ("VERSTAPPEN" / "Max VERSTAPPEN" → "Verstappen")
  const lastName = titleCaseName(teamOrDriver.split(/\s+/).pop() ?? "");
  const lastNameTeam = DRIVER_LAST_NAME_MAP[lastName];
  if (lastNameTeam && F1_TEAM_COLORS[lastNameTeam]) return F1_TEAM_COLORS[lastNameTeam];

  return F1_TEAM_COLORS.default;
}

export function getTeamForDriver(driverName: string): string {
  return F1_DRIVER_TEAMS[driverName] || "Unknown Team"
}

// Mix a hex color toward white. amount 0 = unchanged, 1 = white.
function lightenHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const channel = (shift: number): number => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount);
  };
  const toHex = (c: number): string => c.toString(16).padStart(2, "0");
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`.toUpperCase();
}

/**
 * Per-series colors for a multi-driver chart, with teammates kept
 * distinguishable. Team color alone fails exactly when the comparison is
 * most interesting — teammates (Hamilton vs Leclerc rendered as two
 * identical Ferrari-red lines). The first driver on a team keeps the team
 * color; each subsequent teammate gets a progressively lightened variant.
 * Order-stable: colors are assigned in the order names are passed.
 */
export function getDistinctTeamColors(driverNames: string[]): Record<string, string> {
  // F28 (golden-set audit 2026-07-02): the base team color used to go to
  // whichever teammate appeared FIRST in the input array, so Norris/Piastri
  // and Russell/Antonelli swapped colors between cards of the same session
  // depending on driver order. Assign deterministically: within each
  // base-color group, the alphabetically-first driver gets the base color
  // and the rest get progressively lighter shades — stable across cards.
  const groups = new Map<string, string[]>();
  for (const name of new Set(driverNames)) {
    const base = getTeamColor(name);
    (groups.get(base) ?? groups.set(base, []).get(base)!).push(name);
  }
  const out: Record<string, string> = {};
  for (const [base, names] of groups) {
    names.sort((a, b) => a.localeCompare(b));
    names.forEach((name, i) => {
      out[name] = i === 0 ? base : lightenHex(base, Math.min(0.65, 0.35 * i));
    });
  }
  return out;
}

export interface DriverSeriesStyle {
  color: string;
  strokeDasharray?: string; // undefined = solid
}

/**
 * Per-series {color, dash} for a multi-driver LINE chart, with same-team
 * drivers made distinguishable by a genuinely different HUE (the team's
 * secondary/accent color), not a lightened shade. This is the fix for the
 * "two Ferrari-red / two Sauber-green overlapping lines" bug: hue separation
 * survives dense overlapping traces where lightness alone doesn't.
 *
 *   1st teammate  → team primary color, solid
 *   2nd teammate  → team SECONDARY color, solid  (distinct hue)
 *   3rd+ teammate → lightened primary + dashed   (rare fallback)
 *
 * Cross-team drivers each keep their own team color (already distinct).
 * Deterministic: within a team, drivers are sorted by name so the same driver
 * gets the same color across every card of a session (stable A/B assignment).
 */
export function getDistinctTeamStyles(driverNames: string[]): Record<string, DriverSeriesStyle> {
  const groups = new Map<string, string[]>();
  for (const name of new Set(driverNames)) {
    const base = getTeamColor(name);
    (groups.get(base) ?? groups.set(base, []).get(base)!).push(name);
  }
  const out: Record<string, DriverSeriesStyle> = {};
  for (const [base, names] of groups) {
    // Normalize the sort key so "Max VERSTAPPEN" and "Max Verstappen" order the
    // same way — the A/B assignment must be stable across a session's cards.
    names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const secondary = SECONDARY_BY_PRIMARY[base] ?? F1_TEAM_SECONDARY_COLORS.default;
    names.forEach((name, i) => {
      if (i === 0) {
        out[name] = { color: base };
      } else if (i === 1) {
        // Distinct hue for the head-to-head teammate.
        out[name] = { color: secondary };
      } else {
        // 3+ same-team (rare): fall back to lighten + dash so they stay apart.
        out[name] = {
          color: lightenHex(base, Math.min(0.65, 0.3 * (i - 1))),
          strokeDasharray: i % 2 === 0 ? "6 3" : "2 3",
        };
      }
    });
  }
  return out;
}

// Lookup by last name for chart labels. When a driver swapped teams
// mid-season we pick the team they finished the season on; charts
// for earlier rounds can override at the call site if necessary.
const DRIVER_LAST_NAME_MAP: Record<string, string> = {
  "Verstappen": "Red Bull Racing",
  "Perez": "Red Bull Racing",
  "Tsunoda": "Red Bull Racing",
  "Hamilton": "Ferrari",
  "Leclerc": "Ferrari",
  "Russell": "Mercedes",
  "Antonelli": "Mercedes",
  "Norris": "McLaren",
  "Piastri": "McLaren",
  "Alonso": "Aston Martin",
  "Stroll": "Aston Martin",
  "Gasly": "Alpine",
  "Doohan": "Alpine",
  "Colapinto": "Alpine",
  "Albon": "Williams",
  "Sainz": "Williams",
  "Hadjar": "RB",
  "Lawson": "RB",
  "Hülkenberg": "Sauber",
  "Hulkenberg": "Sauber",
  "Bortoleto": "Sauber",
  "Ocon": "Haas",
  "Bearman": "Haas",
}

export function getTeamColorByDriver(driverName: string): string {
  if (!driverName) return F1_TEAM_COLORS.default

  // 1. Direct team lookup
  if (F1_TEAM_COLORS[driverName]) return F1_TEAM_COLORS[driverName]

  // 2. Direct full-name lookup
  if (F1_DRIVER_TEAMS[driverName]) return F1_TEAM_COLORS[F1_DRIVER_TEAMS[driverName]]

  // 3. Title-cased full-name lookup ("Lewis HAMILTON" → "Lewis Hamilton")
  const titled = titleCaseName(driverName)
  if (F1_DRIVER_TEAMS[titled]) return F1_TEAM_COLORS[F1_DRIVER_TEAMS[titled]]

  // 4. Last-name lookup ("HAMILTON" or "Lewis HAMILTON" → "Hamilton")
  const lastName = titleCaseName(driverName.split(/\s+/).pop() ?? "")
  if (DRIVER_LAST_NAME_MAP[lastName]) {
    return F1_TEAM_COLORS[DRIVER_LAST_NAME_MAP[lastName]]
  }

  return F1_TEAM_COLORS.default
}

// =============================================================================
// Phase 10: token consolidation. Compound + chart-semantic colors live
// alongside team colors so all chart renderers + builders import from a
// single visual-tokens module. mapInsight.ts's local COMPOUND_HEX +
// inlined chart-semantic hexes can re-export from here.
// =============================================================================

/** Tyre compound colors used in stint Gantt + tyre-strategy charts. */
export const COMPOUND_COLORS: Record<string, string> = {
  hard: "#E5E7EB",
  medium: "#FCD34D",
  soft: "#EF4444",
  inter: "#22C55E",
  intermediate: "#22C55E",
  wet: "#3B82F6"
}

/** Chart-semantic colors used across renderers (success, warning,
 *  in-traffic / dirty-air emphasis). The F1 red accent (#E10600) is
 *  the primary highlight color used elsewhere — driving design system. */
export const CHART_SEMANTIC_COLORS = {
  positive: "#22C55E",
  negative: "#E10600",
  warning: "#F59E0B",
  neutral: "#A3A3A3",
  cleanAir: "#22C55E",
  inTraffic: "#E10600",
  rainfall: "#1868DB",
  trackTemp: "#F59E0B"
} as const

/** Status-grid cell colors for data-coverage display. */
export const COVERAGE_STATUS_COLORS = {
  full: "#22C55E",
  partial: "#F59E0B",
  missing: "#EF4444"
} as const
