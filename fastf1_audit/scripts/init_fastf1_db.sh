#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR"
  echo "Copy .env.example to .env first."
  exit 1
fi

set -a
source .env
set +a

export PGPASSWORD="$FASTF1_DB_PASSWORD"
export DISABLE_SQLALCHEMY_CEXT_RUNTIME="${DISABLE_SQLALCHEMY_CEXT_RUNTIME:-1}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found in PATH. Install PostgreSQL client tools first."
  exit 1
fi

echo "Checking Postgres connectivity on ${FASTF1_DB_HOST}:${FASTF1_DB_PORT} as ${FASTF1_DB_USER}..."
psql \
  -h "$FASTF1_DB_HOST" \
  -p "$FASTF1_DB_PORT" \
  -U "$FASTF1_DB_USER" \
  -d postgres \
  -c "SELECT 1;" >/dev/null

if ! psql \
  -h "$FASTF1_DB_HOST" \
  -p "$FASTF1_DB_PORT" \
  -U "$FASTF1_DB_USER" \
  -d postgres \
  -tAc "SELECT 1 FROM pg_database WHERE datname='${FASTF1_DB_NAME}'" | grep -q 1; then
  echo "Database ${FASTF1_DB_NAME} does not exist. Creating it..."
  createdb \
    -h "$FASTF1_DB_HOST" \
    -p "$FASTF1_DB_PORT" \
    -U "$FASTF1_DB_USER" \
    "$FASTF1_DB_NAME"
fi

psql \
  -h "$FASTF1_DB_HOST" \
  -p "$FASTF1_DB_PORT" \
  -U "$FASTF1_DB_USER" \
  -d "$FASTF1_DB_NAME" \
  -f sql/001_create_fastf1_schema.sql

psql \
  -h "$FASTF1_DB_HOST" \
  -p "$FASTF1_DB_PORT" \
  -U "$FASTF1_DB_USER" \
  -d "$FASTF1_DB_NAME" \
  -f sql/002_create_fastf1_views.sql

echo "Initialized FastF1 audit schema in $FASTF1_DB_NAME"
