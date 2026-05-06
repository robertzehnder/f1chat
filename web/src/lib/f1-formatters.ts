// Format driver name from "VERSTAPPEN" or "Max VERSTAPPEN" to "Max Verstappen"
export function formatDriverName(name: string): string {
  if (!name) return ""
  
  const parts = name.trim().split(" ")
  return parts.map(part => {
    if (part.toUpperCase() === part) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    }
    return part
  }).join(" ")
}

// Format speed to 1 decimal place with unit
export function formatSpeed(speed: number | string, unit: string = "km/h"): string {
  const num = typeof speed === "string" ? parseFloat(speed) : speed
  if (isNaN(num)) return "N/A"
  return `${num.toFixed(1)} ${unit}`
}

// Format speed difference with + or - sign
export function formatSpeedDiff(diff: number): string {
  const sign = diff >= 0 ? "+" : ""
  return `${sign}${diff.toFixed(1)} km/h`
}

// Format lap time from seconds to MM:SS.sss
export function formatLapTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "N/A"
  
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  
  if (mins > 0) {
    return `${mins}:${secs.toFixed(3).padStart(6, "0")}`
  }
  return secs.toFixed(3)
}

// Format session type
export function formatSessionType(type: string): string {
  const types: Record<string, string> = {
    "Race": "Race",
    "Qualifying": "Qualifying",
    "Q1": "Qualifying - Q1",
    "Q2": "Qualifying - Q2",
    "Q3": "Qualifying - Q3",
    "Sprint": "Sprint",
    "Sprint Shootout": "Sprint Shootout",
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
  }
  return types[type] || type
}

// Format corner name
export function formatCorner(cornerNumber: number, cornerLabel?: string): string {
  if (cornerLabel) {
    return `Turn ${cornerNumber} (${cornerLabel})`
  }
  return `Turn ${cornerNumber}`
}

// Format session info
export function formatSessionInfo(year: number, country: string, gpName: string, sessionType: string): string {
  return `${year} ${gpName} GP - ${formatSessionType(sessionType)}`
}

// Get ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
export function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
