type DataTableProps = {
  title?: string;
  rows: Record<string, unknown>[];
  maxHeight?: string;
};

export function DataTable({ title, rows, maxHeight = "420px" }: DataTableProps) {
  if (!rows.length) {
    return (
      <section className="card">
        {title ? <h3>{title}</h3> : null}
        <p className="muted">No rows returned.</p>
      </section>
    );
  }

  const columns = Object.keys(rows[0]);

  return (
    <section className="card">
      {title ? <h3>{title}</h3> : null}
      <div className="table-wrap" style={{ maxHeight }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column}>
                    {row[column] === null || row[column] === undefined
                      ? ""
                      : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
