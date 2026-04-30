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

export function buildSectorAnswer(rows: Record<string, unknown>[]): string {
  const sectorRows = rows
    .map((row) => ({
      label: driverLabel(row),
      bestS1: asNumber(row.best_s1),
      bestS2: asNumber(row.best_s2),
      bestS3: asNumber(row.best_s3),
      avgS1: asNumber(row.avg_s1),
      avgS2: asNumber(row.avg_s2),
      avgS3: asNumber(row.avg_s3)
    }))
    .filter((row) => row.bestS1 !== null || row.bestS2 !== null || row.bestS3 !== null);

  if (sectorRows.length < 2) {
    return "";
  }

  const bestOf = (metric: "bestS1" | "bestS2" | "bestS3" | "avgS1" | "avgS2" | "avgS3") =>
    sectorRows
      .filter((row) => row[metric] !== null)
      .sort((a, b) => (a[metric] as number) - (b[metric] as number))[0];

  const bestS1 = bestOf("bestS1");
  const bestS2 = bestOf("bestS2");
  const bestS3 = bestOf("bestS3");
  const avgS1 = bestOf("avgS1");
  const avgS2 = bestOf("avgS2");
  const avgS3 = bestOf("avgS3");

  if (!bestS1 || !bestS2 || !bestS3) {
    return "";
  }

  return `Best sectors: S1 ${bestS1.label}, S2 ${bestS2.label}, S3 ${bestS3.label}. Average sectors: S1 ${avgS1?.label ?? "n/a"}, S2 ${avgS2?.label ?? "n/a"}, S3 ${avgS3?.label ?? "n/a"}.`;
}
