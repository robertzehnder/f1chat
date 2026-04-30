const HAS_FLAGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "has_core_analysis_pack", label: "core_analysis_pack" },
  { key: "has_drivers", label: "drivers" },
  { key: "has_laps", label: "laps" },
  { key: "has_pit", label: "pit" },
  { key: "has_stints", label: "stints" },
  { key: "has_weather", label: "weather" },
  { key: "has_team_radio", label: "team_radio" },
  { key: "has_position_history", label: "position_history" },
  { key: "has_intervals", label: "intervals" },
  { key: "has_car_data", label: "car_data" },
  { key: "has_location", label: "location" },
  { key: "has_session_result", label: "session_result" },
  { key: "has_starting_grid", label: "starting_grid" },
  { key: "has_race_control", label: "race_control" }
];

function formatCoverage(row: Record<string, unknown>): string {
  const labels = HAS_FLAGS.filter((flag) => Boolean(row[flag.key])).map((flag) => flag.label);
  return labels.length ? labels.join(", ") : "—";
}

export default function CompletenessTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <section className="card">
        <h3>Session Completeness</h3>
        <p className="muted">No session completeness rows returned.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Session Completeness</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9aa0a6" }}>
              <th style={{ padding: "6px 8px" }}>session_key</th>
              <th style={{ padding: "6px 8px" }}>year</th>
              <th style={{ padding: "6px 8px" }}>meeting_name</th>
              <th style={{ padding: "6px 8px" }}>normalized_session_type</th>
              <th style={{ padding: "6px 8px" }}>completeness_status</th>
              <th style={{ padding: "6px 8px" }}>completeness_score</th>
              <th style={{ padding: "6px 8px" }}>contracts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const session_key = row.session_key;
              const year = row.year;
              const meeting_name = row.meeting_name;
              const normalized_session_type = row.normalized_session_type;
              const completeness_status = row.completeness_status;
              const completeness_score = row.completeness_score;
              const coverage = formatCoverage(row);
              return (
                <tr
                  key={String(session_key)}
                  data-testid="completeness-row"
                  style={{ borderTop: "1px solid #2a2d31", color: "#cfd2d6" }}
                >
                  <td style={{ padding: "6px 8px" }}>{String(session_key ?? "")}</td>
                  <td style={{ padding: "6px 8px" }}>{String(year ?? "")}</td>
                  <td style={{ padding: "6px 8px" }}>{String(meeting_name ?? "")}</td>
                  <td style={{ padding: "6px 8px" }}>{String(normalized_session_type ?? "")}</td>
                  <td data-testid="completeness-status" style={{ padding: "6px 8px" }}>
                    {String(completeness_status ?? "")}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{String(completeness_score ?? "")}</td>
                  <td data-testid="completeness-coverage" style={{ padding: "6px 8px" }}>
                    {coverage}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
