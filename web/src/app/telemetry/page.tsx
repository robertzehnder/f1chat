import { DataTable } from "@/components/DataTable";
import { getSessionTelemetry } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SearchParams = {
  sessionKey?: string;
  table?: string;
  driverNumber?: string;
  fromDate?: string;
  toDate?: string;
  limit?: string;
};

export default async function TelemetryPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const table = params.table ?? "car_data";
  const sessionKey = Number(params.sessionKey);
  const driverNumber = params.driverNumber ? Number(params.driverNumber) : undefined;
  const limit = params.limit ? Number(params.limit) : 1000;

  const canRun = Number.isFinite(sessionKey);
  const rows =
    canRun && Number.isFinite(sessionKey)
      ? await getSessionTelemetry({
          sessionKey,
          table,
          driverNumber: Number.isFinite(driverNumber) ? driverNumber : undefined,
          fromDate: params.fromDate,
          toDate: params.toDate,
          limit: Number.isFinite(limit) ? limit : 1000
        }).catch((error: unknown) => [
          { error: error instanceof Error ? error.message : "Failed to fetch telemetry" }
        ])
      : [];

  return (
    <div className="stack">
      <section className="card">
        <h2 className="panel-title">Telemetry Explorer</h2>
        <p className="muted">
          Query one telemetry table at a time. Keep filters tight to avoid heavy scans.
        </p>
        <form className="filter-form" method="GET">
          <label>
            Session Key
            <input type="number" name="sessionKey" required defaultValue={params.sessionKey ?? ""} />
          </label>
          <label>
            Table
            <select name="table" defaultValue={table}>
              <option value="car_data">car_data</option>
              <option value="location">location</option>
              <option value="intervals">intervals</option>
              <option value="position_history">position_history</option>
            </select>
          </label>
          <label>
            Driver Number
            <input type="number" name="driverNumber" defaultValue={params.driverNumber ?? ""} />
          </label>
          <label>
            From Date (UTC)
            <input type="text" name="fromDate" placeholder="2025-12-07T13:00:00Z" defaultValue={params.fromDate ?? ""} />
          </label>
          <label>
            To Date (UTC)
            <input type="text" name="toDate" placeholder="2025-12-07T13:05:00Z" defaultValue={params.toDate ?? ""} />
          </label>
          <label>
            Limit
            <input type="number" name="limit" defaultValue={params.limit ?? "1000"} />
          </label>
          <button type="submit">Run</button>
        </form>
      </section>

      <DataTable
        title={canRun ? `Telemetry Preview (${table})` : "Telemetry Preview"}
        rows={rows}
        maxHeight="560px"
      />
    </div>
  );
}
