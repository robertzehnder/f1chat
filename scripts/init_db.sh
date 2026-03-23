#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=openf1}"
: "${DB_USER:=openf1}"
: "${DB_PASSWORD:=openf1_local_dev}"

export PGPASSWORD="$DB_PASSWORD"

for f in \
  sql/001_create_schemas.sql \
  sql/002_create_tables.sql \
  sql/003_indexes.sql \
  sql/004_constraints.sql \
  sql/005_helper_tables.sql \
  sql/006_semantic_lap_layer.sql \
  sql/007_semantic_summary_contracts.sql
do
  echo "Applying $f"
  psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -f "$f"
done

if [ -d "$ROOT_DIR/f1_codex_helpers" ]; then
  echo "Loading helper lookups from $ROOT_DIR/f1_codex_helpers"
  "$ROOT_DIR/scripts/load_codex_helpers.sh"
fi

echo "Database initialized."
