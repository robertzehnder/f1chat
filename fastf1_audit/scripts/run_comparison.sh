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

export DISABLE_SQLALCHEMY_CEXT_RUNTIME="${DISABLE_SQLALCHEMY_CEXT_RUNTIME:-1}"

if [[ ! -d .venv ]]; then
  echo "Missing virtualenv at $ROOT_DIR/.venv"
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source .venv/bin/activate
python3 -m src.compare_fastf1_openf1

echo "Comparison completed. See reports/"
