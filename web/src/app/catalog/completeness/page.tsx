import { getCatalogCompleteness } from "@/lib/queries/sessions";
import CompletenessTable from "./CompletenessTable";

export const dynamic = "force-dynamic";

export default async function CatalogCompletenessPage() {
  const rows = await getCatalogCompleteness({});

  return (
    <div className="stack">
      <section className="card">
        <h2 className="panel-title">Session Completeness</h2>
        <p className="muted">
          Per-session completeness bucket and contract-coverage flags from
          `core.session_completeness`.
        </p>
      </section>
      <CompletenessTable rows={rows} />
    </div>
  );
}
