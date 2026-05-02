#!/usr/bin/env bash
# Initialise (or upgrade) the openf1 schema via sqitch.
#
# All schema changes are managed under sql/migrations/ as sqitch deploy/
# revert/verify scripts. This script just runs `sqitch deploy` against the
# configured local DB and then loads helper lookups. See
# sql/migrations/README.md for the full deploy / rollback runbook.

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

TARGET="db:pg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "Deploying schema via sqitch -> ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
sqitch --chdir sql/migrations deploy "$TARGET"

if [ -d "$ROOT_DIR/f1_codex_helpers" ]; then
  echo "Loading helper lookups from $ROOT_DIR/f1_codex_helpers"
  "$ROOT_DIR/scripts/load_codex_helpers.sh"
fi

echo "Database initialized."
