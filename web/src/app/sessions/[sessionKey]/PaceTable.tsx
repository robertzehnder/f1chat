import { DataTable } from "@/components/DataTable";

export default function PaceTable({ rows }: { rows: Record<string, unknown>[] }) {
  return <DataTable title="Per-driver Pace" rows={rows} />;
}
