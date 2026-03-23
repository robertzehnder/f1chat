#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/init_fastf1_db.sh
./scripts/extract_fastf1.sh
./scripts/run_comparison.sh
./scripts/export_reports.sh

echo "Full FastF1/OpenF1 audit run completed."
