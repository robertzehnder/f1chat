#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=openf1}"
: "${DB_USER:=openf1}"
: "${DB_PASSWORD:=openf1_local_dev}"
: "${HELPERS_DIR:=$ROOT_DIR/f1_codex_helpers}"

if [ ! -d "$HELPERS_DIR" ]; then
  echo "Helpers directory not found: $HELPERS_DIR"
  exit 1
fi

for required_file in \
  session_venue_alias_lookup.csv \
  driver_alias_lookup.csv \
  session_type_alias_lookup.csv \
  team_alias_lookup.csv \
  weekend_session_expectation_rules.csv \
  source_anomaly_manual.csv \
  benchmark_question_type_lookup.csv \
  query_template_registry.json
do
  if [ ! -f "$HELPERS_DIR/$required_file" ]; then
    echo "Missing helper file: $HELPERS_DIR/$required_file"
    exit 1
  fi
done

export PGPASSWORD="$DB_PASSWORD"

TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT

node -e "
const fs = require('fs');
const filePath = process.argv[1];
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
for (const [templateKey, payload] of Object.entries(data)) {
  const escapedKey = String(templateKey).replace(/'/g, \"''\");
  const escapedPayload = JSON.stringify(payload).replace(/'/g, \"''\");
  process.stdout.write(
    \`INSERT INTO core.query_template_registry (template_key, payload, updated_at) VALUES ('\${escapedKey}', '\${escapedPayload}'::jsonb, NOW()) ON CONFLICT (template_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();\\n\`
  );
}
" "$HELPERS_DIR/query_template_registry.json" > "$TMP_SQL"

psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 <<SQL
TRUNCATE TABLE
  core.session_venue_alias_lookup,
  core.driver_alias_lookup,
  core.session_type_alias_lookup,
  core.team_alias_lookup,
  core.weekend_session_expectation_rules,
  core.source_anomaly_manual,
  core.benchmark_question_type_lookup,
  core.query_template_registry;

\copy core.session_venue_alias_lookup (alias_text, alias_type, country_name, location, circuit_short_name, notes) FROM '$HELPERS_DIR/session_venue_alias_lookup.csv' WITH (FORMAT csv, HEADER true);
\copy core.driver_alias_lookup (driver_number, canonical_full_name, first_name, last_name, name_acronym, broadcast_name, alias_text, alias_type) FROM '$HELPERS_DIR/driver_alias_lookup.csv' WITH (FORMAT csv, HEADER true);
\copy core.session_type_alias_lookup (raw_session_name, normalized_session_type, alias_text, notes) FROM '$HELPERS_DIR/session_type_alias_lookup.csv' WITH (FORMAT csv, HEADER true);
\copy core.team_alias_lookup (alias_text, alias_type, canonical_team_name, active_from_year, active_to_year, notes) FROM '$HELPERS_DIR/team_alias_lookup.csv' WITH (FORMAT csv, HEADER true);
\copy core.weekend_session_expectation_rules (weekend_format, expected_session_type, min_expected_count, max_expected_count, active_from_year, active_to_year, notes) FROM '$HELPERS_DIR/weekend_session_expectation_rules.csv' WITH (FORMAT csv, HEADER true);
\copy core.source_anomaly_manual (anomaly_id, anomaly_type, severity, subsystem, status, year, session_key, meeting_key, driver_number, entity_label, symptom, details, evidence_ref, source_system) FROM '$HELPERS_DIR/source_anomaly_manual.csv' WITH (FORMAT csv, HEADER true);
\copy core.benchmark_question_type_lookup (question_type, theme, preferred_grain, preferred_tables, fallback_tables, requires_session, notes) FROM '$HELPERS_DIR/benchmark_question_type_lookup.csv' WITH (FORMAT csv, HEADER true);

UPDATE core.session_venue_alias_lookup
SET
  normalized_alias = LOWER(BTRIM(alias_text)),
  updated_at = NOW();

UPDATE core.driver_alias_lookup
SET
  normalized_alias = LOWER(BTRIM(alias_text)),
  updated_at = NOW();

UPDATE core.session_type_alias_lookup
SET
  normalized_alias = LOWER(BTRIM(alias_text)),
  updated_at = NOW();

UPDATE core.team_alias_lookup
SET
  normalized_alias = LOWER(BTRIM(alias_text)),
  updated_at = NOW();

UPDATE core.weekend_session_expectation_rules
SET
  updated_at = NOW();

UPDATE core.source_anomaly_manual
SET
  updated_at = NOW();

UPDATE core.benchmark_question_type_lookup
SET
  updated_at = NOW();
SQL

psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -f "$TMP_SQL"

echo "Loaded helper lookup seeds from $HELPERS_DIR"
