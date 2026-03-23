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

STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUT_DIR="${EXPORT_DIR}/audit_${STAMP}"

mkdir -p "$OUT_DIR"
cp -a "${REPORT_DIR}/." "$OUT_DIR/"

echo "Exported reports to $OUT_DIR"
