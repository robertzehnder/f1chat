function formatCompounds(compounds_used: unknown): string {
  if (!Array.isArray(compounds_used) || compounds_used.length === 0) return "—";
  return compounds_used.map((c) => String(c)).join(", ");
}

export default function StrategySummary({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <section className="card">
        <h3>Strategy Summary</h3>
        <p className="muted">No strategy rows returned.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Strategy Summary</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {rows.map((row) => {
          const driverNumber = row.driver_number;
          const driverName = row.driver_name;
          const teamName = row.team_name;
          const pit_stop_count = row.pit_stop_count;
          const strategy_type = row.strategy_type;
          const compoundsLabel = formatCompounds(row.compounds_used);
          return (
            <div
              key={`${String(driverNumber)}`}
              data-testid="strategy-row"
              style={{
                display: "grid",
                gridTemplateColumns: "260px 80px 1fr 120px",
                alignItems: "center",
                gap: "12px",
                fontSize: "13px"
              }}
            >
              <div style={{ color: "#cfd2d6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                #{String(driverNumber ?? "")} {String(driverName ?? "")} · {String(teamName ?? "")}
              </div>
              <div style={{ color: "#cfd2d6" }}>
                {String(pit_stop_count ?? 0)} pit
              </div>
              <div style={{ color: "#cfd2d6" }}>
                {compoundsLabel}
              </div>
              <div data-testid="strategy-type" style={{ color: "#cfd2d6" }}>
                {String(strategy_type ?? "—")}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
