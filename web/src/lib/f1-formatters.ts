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

// Format a lap time / duration in seconds.
//   ≥ 60s → "M:SS.mmm"   (82.878 → "1:22.878")
//   <  60s → "SS.mmms"    (22.63  → "22.630s")
// Returns "" for non-finite input so callers can choose a fallback.
export function formatLapTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return ""
  const abs = Math.abs(seconds)
  if (abs >= 60) {
    const sign = seconds < 0 ? "-" : ""
    const mins = Math.floor(abs / 60)
    const secs = abs - mins * 60
    return `${sign}${mins}:${secs.toFixed(3).padStart(6, "0")}`
  }
  return `${seconds.toFixed(3)}s`
}

// Format a signed per-lap delta or gap.
//   0.36  → "+0.360s",  -0.26 → "-0.260s"
export function formatDeltaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return ""
  const sign = seconds >= 0 ? "+" : ""
  return `${sign}${seconds.toFixed(3)}s`
}

// Dispatch a chart's y_value_format hint to the right formatter.
export function formatChartValue(value: number, fmt: string | undefined): string {
  if (!Number.isFinite(value)) return ""
  switch (fmt) {
    case "lap_time_s":
      return formatLapTime(value)
    case "decimal_seconds":
      return formatDeltaSeconds(value)
    case "kph":
      return `${value.toFixed(1)} km/h`
    case "percent":
      return `${value.toFixed(1)}%`
    default:
      return value.toFixed(1)
  }
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
