import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { getSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SearchParams = {
  year?: string;
  country?: string;
  q?: string;
  limit?: string;
};

export default async function SessionsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const year = params.year ? Number(params.year) : undefined;
  const limit = params.limit ? Number(params.limit) : 100;

  const sessions = await getSessions({
    year: Number.isFinite(year) ? year : undefined,
    country: params.country,
    search: params.q,
    limit: Number.isFinite(limit) ? limit : 100
  });

  const rowsForTable = sessions.map((row) => ({
    ...row,
    session_link: `/sessions/${String(row.session_key)}`
  }));

  return (
    <div className="stack">
      <section className="card">
        <h2 className="panel-title">Session Browser</h2>
        <p className="muted">
          Filter by season and location. Open a session to inspect drivers, laps, and completeness
          indicators.
        </p>
        <form className="filter-form" method="GET">
          <label>
            Year
            <input type="number" name="year" defaultValue={params.year ?? ""} />
          </label>
          <label>
            Country
            <input type="text" name="country" defaultValue={params.country ?? ""} />
          </label>
          <label>
            Search
            <input type="text" name="q" defaultValue={params.q ?? ""} />
          </label>
          <label>
            Limit
            <input type="number" name="limit" defaultValue={params.limit ?? "100"} />
          </label>
          <button type="submit">Apply</button>
        </form>
      </section>

      <section className="card">
        <p className="muted">Rows returned: {sessions.length}</p>
        <div className="stack">
          {sessions.slice(0, 20).map((row) => (
            <Link key={String(row.session_key)} href={`/sessions/${String(row.session_key)}`}>
              Session {String(row.session_key)} · {String(row.meeting_name ?? "Unknown meeting")} ·{" "}
              {String(row.date_start ?? "")}
            </Link>
          ))}
        </div>
      </section>

      <DataTable rows={rowsForTable} title="Session List (with row-count signals)" maxHeight="560px" />
    </div>
  );
}
