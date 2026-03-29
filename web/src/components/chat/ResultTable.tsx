type ResultTableProps = {
  title?: string;
  rows: Record<string, unknown>[];
  maxHeight?: string;
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
};

export function ResultTable({
  title,
  rows,
  maxHeight = "min(360px,35vh)",
  rowCount,
  elapsedMs,
  truncated
}: ResultTableProps) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-border bg-white px-3 py-2.5 text-[13px] text-ink-secondary shadow-card">
        {title ? <p className="m-0 mb-1 font-medium text-ink">{title}</p> : null}
        No rows returned.
      </div>
    );
  }

  const columns = Object.keys(rows[0]);
  const displayCount = rows.length;
  const totalCount = rowCount ?? displayCount;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white shadow-card">
      {title || rowCount != null ? (
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface-secondary px-3 py-2">
          {title ? (
            <span className="text-[13px] font-medium text-ink-secondary">{title}</span>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-tertiary">
            {totalCount} rows
            {elapsedMs != null ? ` · ${elapsedMs}ms` : ""}
          </span>
        </div>
      ) : null}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-secondary">
              {columns.map((column) => (
                <th
                  key={column}
                  className="sticky top-0 bg-surface-secondary px-2.5 py-2 text-left font-sans text-xs font-semibold uppercase text-ink-secondary"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className={`border-b border-border-subtle/60 ${
                  index % 2 === 0 ? "bg-white" : "bg-surface-secondary"
                } hover:bg-surface-hover`}
              >
                {columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-2.5 py-1.5 text-ink">
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
      {truncated && totalCount > displayCount ? (
        <div className="border-t border-border-subtle bg-surface-secondary px-3 py-1.5 text-xs text-ink-tertiary">
          Showing first {displayCount} of {totalCount} rows
        </div>
      ) : null}
    </div>
  );
}
