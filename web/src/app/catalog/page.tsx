import { DataTable } from "@/components/DataTable";
import { getSchemaCatalog } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const rows = await getSchemaCatalog();

  return (
    <div className="stack">
      <section className="card">
        <h2 className="panel-title">Schema Catalog</h2>
        <p className="muted">
          Column-level metadata for `raw` and `core` schemas. Use this as the app’s exploration
          and chat grounding source.
        </p>
      </section>

      <DataTable rows={rows} title="information_schema.columns" maxHeight="640px" />
    </div>
  );
}
