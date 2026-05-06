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

export const F1_DRIVER_TEAMS: Record<string, string> = {
  "Max Verstappen": "Red Bull Racing",
  "Sergio Perez": "Red Bull Racing",
  "Lewis Hamilton": "Ferrari",
  "Charles Leclerc": "Ferrari",
  "George Russell": "Mercedes",
  "Andrea Kimi Antonelli": "Mercedes",
  "Lando Norris": "McLaren",
  "Oscar Piastri": "McLaren",
  "Fernando Alonso": "Aston Martin",
  "Lance Stroll": "Aston Martin",
  "Pierre Gasly": "Alpine",
  "Jack Doohan": "Alpine",
  "Alex Albon": "Williams",
  "Carlos Sainz": "Williams",
  "Yuki Tsunoda": "RB",
  "Isack Hadjar": "RB",
  "Nico Hulkenberg": "Sauber",
  "Gabriel Bortoleto": "Sauber",
  "Esteban Ocon": "Haas",
  "Oliver Bearman": "Haas",
}

export function getTeamColor(teamOrDriver: string): string {
  // Check if it's a team name directly
  if (F1_TEAM_COLORS[teamOrDriver]) {
    return F1_TEAM_COLORS[teamOrDriver]
  }
  
  // Check if it's a driver name
  const team = F1_DRIVER_TEAMS[teamOrDriver]
  if (team && F1_TEAM_COLORS[team]) {
    return F1_TEAM_COLORS[team]
  }
  
  return F1_TEAM_COLORS.default
}

export function getTeamForDriver(driverName: string): string {
  return F1_DRIVER_TEAMS[driverName] || "Unknown Team"
}

// Lookup by last name for chart labels
const DRIVER_LAST_NAME_MAP: Record<string, string> = {
  "Verstappen": "Red Bull Racing",
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
  "Albon": "Williams",
  "Sainz": "Williams",
  "Tsunoda": "RB",
  "Hadjar": "RB",
  "Hülkenberg": "Sauber",
  "Hulkenberg": "Sauber",
  "Bortoleto": "Sauber",
  "Ocon": "Haas",
  "Bearman": "Haas",
  "Perez": "Red Bull Racing",
}

export function getTeamColorByDriver(driverName: string): string {
  // Direct team lookup
  if (F1_TEAM_COLORS[driverName]) {
    return F1_TEAM_COLORS[driverName]
  }
  
  // Full name lookup
  if (F1_DRIVER_TEAMS[driverName]) {
    return F1_TEAM_COLORS[F1_DRIVER_TEAMS[driverName]]
  }
  
  // Last name lookup for chart labels
  if (DRIVER_LAST_NAME_MAP[driverName]) {
    return F1_TEAM_COLORS[DRIVER_LAST_NAME_MAP[driverName]]
  }
  
  return F1_TEAM_COLORS.default
}
