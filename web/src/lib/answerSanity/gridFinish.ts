function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function driverLabel(row: Record<string, unknown>): string {
  return (
    asString(row.full_name) ??
    asString(row.driver_name) ??
    (asNumber(row.driver_number) !== null ? `Driver #${asNumber(row.driver_number)}` : "Driver")
  );
}

export function buildPositionsAnswer(rows: Record<string, unknown>[]): string {
  const ranked = rows
    .map((row) => {
      const label = driverLabel(row);
      const grid = asNumber(row.grid_position);
      const finish = asNumber(row.finish_position);
      const positionsGained =
        asNumber(row.positions_gained) ??
        (grid !== null && finish !== null ? grid - finish : null);
      return { label, grid, finish, positionsGained };
    })
    .filter((row) => row.grid !== null && row.finish !== null && row.positionsGained !== null);

  if (!ranked.length) {
    return "The rows do not include complete grid and finish positions for both drivers, so positions gained/lost cannot be stated confidently.";
  }

  ranked.sort((a, b) => (b.positionsGained ?? -999) - (a.positionsGained ?? -999));
  const winner = ranked[0];
  return `${winner.label} gained more positions (${winner.positionsGained}) based on grid ${winner.grid} to finish ${winner.finish}.`;
}
