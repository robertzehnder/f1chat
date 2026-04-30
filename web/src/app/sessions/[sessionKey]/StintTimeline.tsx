const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#e63946",
  MEDIUM: "#f4d35e",
  HARD: "#f5f5f5",
  INTERMEDIATE: "#43aa8b",
  WET: "#2a9df4"
};

const NEUTRAL_COMPOUND_COLOR = "#9aa0a6";

function compoundColor(compoundName: unknown): string {
  if (typeof compoundName !== "string") return NEUTRAL_COMPOUND_COLOR;
  const key = compoundName.trim().toUpperCase();
  return COMPOUND_COLORS[key] ?? NEUTRAL_COMPOUND_COLOR;
}

export default function StintTimeline({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <section className="card">
        <h3>Stint Timeline</h3>
        <p className="muted">No stint rows returned.</p>
      </section>
    );
  }

  const maxLap = Math.max(1, ...rows.map((r) => Number(r.lap_end ?? 0)));

  const order: number[] = [];
  const grouped = new Map<number, Record<string, unknown>[]>();
  for (const row of rows) {
    const driverNumber = Number(row.driver_number);
    if (!grouped.has(driverNumber)) {
      grouped.set(driverNumber, []);
      order.push(driverNumber);
    }
    grouped.get(driverNumber)!.push(row);
  }

  return (
    <section className="card">
      <h3>Stint Timeline</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {order.map((driverNumber) => {
          const driverRows = grouped.get(driverNumber)!;
          const head = driverRows[0];
          const label = `#${String(head.driver_number ?? "")} ${String(head.driver_name ?? "")} · ${String(head.team_name ?? "")}`;
          return (
            <div
              key={driverNumber}
              data-testid="stint-row"
              style={{ display: "grid", gridTemplateColumns: "220px 1fr", alignItems: "center", gap: "8px" }}
            >
              <div style={{ fontSize: "12px", color: "#cfd2d6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {label}
              </div>
              <div
                data-testid="stint-track"
                style={{ position: "relative", height: "20px", background: "#1f2227", borderRadius: "4px", overflow: "hidden" }}
              >
                {driverRows.map((row, idx) => {
                  const lapStart = Number(row.lap_start ?? 0);
                  const stintLength = Number(row.stint_length_laps ?? 0);
                  const leftPct = Math.max(0, ((lapStart - 1) / maxLap) * 100);
                  const widthPct = Math.max(0, (stintLength / maxLap) * 100);
                  return (
                    <div
                      key={idx}
                      data-testid="stint-bar"
                      title={`${row.compound_name} • ${row.stint_length_laps} laps`}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: compoundColor(row.compound_name),
                        borderRight: "1px solid rgba(0,0,0,0.4)"
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
