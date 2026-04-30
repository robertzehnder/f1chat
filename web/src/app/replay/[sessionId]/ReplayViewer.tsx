export default function ReplayViewer({
  progression,
  frames
}: {
  progression: Record<string, unknown>[];
  frames: Record<string, unknown>[];
}) {
  if (!progression.length) {
    return (
      <section className="card">
        <h2>Replay Viewer</h2>
        <p className="muted">No replay frames available for this session.</p>
      </section>
    );
  }

  const maxLap = Math.max(1, ...progression.map((r) => Number(r.lap_number ?? 0)));
  const numDrivers = Math.max(
    1,
    new Set(progression.map((r) => Number(r.driver_number))).size
  );

  const order: number[] = [];
  const grouped = new Map<number, Record<string, unknown>[]>();
  for (const row of progression) {
    const driverNumber = Number(row.driver_number);
    if (!grouped.has(driverNumber)) {
      grouped.set(driverNumber, []);
      order.push(driverNumber);
    }
    grouped.get(driverNumber)!.push(row);
  }

  return (
    <section className="card">
      <h2>Replay Viewer</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {order.map((driverNumber) => {
          const driverRows = grouped.get(driverNumber)!;
          const head = driverRows[0];
          const label = `#${String(head.driver_number ?? "")} ${String(head.driver_name ?? "")} · ${String(head.team_name ?? "")}`;
          return (
            <div
              key={driverNumber}
              data-testid="replay-driver-row"
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#cfd2d6",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {label}
              </div>
              <div
                data-testid="replay-track"
                style={{
                  position: "relative",
                  height: "24px",
                  background: "#1f2227",
                  borderRadius: "4px",
                  overflow: "hidden"
                }}
              >
                {driverRows.map((row, idx) => {
                  const leftPct = Math.max(
                    0,
                    ((Number(row.lap_number ?? 0) - 1) / maxLap) * 100
                  );
                  const topPct = Math.max(
                    0,
                    ((Number(row.position_end_of_lap ?? 0) - 1) / numDrivers) * 100
                  );
                  return (
                    <div
                      data-testid="replay-lap-marker"
                      title={`Lap ${row.lap_number} • P${row.position_end_of_lap}`}
                      key={idx}
                      style={{
                        position: "absolute",
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#4ea1ff",
                        transform: "translate(-50%, -50%)"
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div
        data-testid="replay-frame-strip"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px",
          marginTop: "12px"
        }}
      >
        {frames.map((row, idx) => {
          const leader = row.leader_driver_number;
          const flag = row.race_control_flag;
          return (
            <div
              key={idx}
              data-testid="replay-frame"
              title={`Lap ${row.lap_number} · leader_driver_number=${String(leader ?? "")} · race_control_flag=${String(flag ?? "")}`}
              style={{
                fontSize: "11px",
                padding: "2px 6px",
                background: "#1f2227",
                borderRadius: "3px",
                color: "#cfd2d6"
              }}
            >
              L{String(row.lap_number ?? "")} · {String(leader ?? "")} · {String(flag ?? "")}
            </div>
          );
        })}
      </div>
    </section>
  );
}
