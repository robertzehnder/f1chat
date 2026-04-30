import { sql } from "@/lib/db";
import SavedAnalysesList from "./SavedAnalysesList";

export const dynamic = "force-dynamic";

export default async function SavedAnalysesPage() {
  const rows = await sql<{ id: number; name: string; created_at: string }>(
    "SELECT id, name, created_at FROM core.saved_analysis ORDER BY created_at DESC LIMIT 200",
    []
  );
  return (
    <div className="stack">
      <section className="card">
        <h2 className="panel-title">Saved Analyses</h2>
      </section>
      <SavedAnalysesList rows={rows} />
    </div>
  );
}
