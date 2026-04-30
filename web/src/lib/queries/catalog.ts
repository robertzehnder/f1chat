import { sql } from "../db";

export async function getSchemaCatalog(): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>>(
    `
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema IN ('raw', 'core')
    ORDER BY table_schema, table_name, ordinal_position
    `
  );
}
