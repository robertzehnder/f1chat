type SavedAnalysisRow = {
  id: number;
  name: string;
  created_at: string;
};

export default function SavedAnalysesList({ rows }: { rows: SavedAnalysisRow[] }) {
  if (rows.length === 0) {
    return <p data-testid="saved-analysis-empty">No saved analyses yet.</p>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>id</th>
          <th>name</th>
          <th>created_at</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-testid="saved-analysis-row">
            <td>{row.id}</td>
            <td>{row.name}</td>
            <td>{row.created_at}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
