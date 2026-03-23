#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR"
  echo "Copy .env.example to .env first."
  exit 1
fi

# Preserve shell overrides (for smoke tests etc.) before sourcing .env.
AUDIT_YEARS_OVERRIDE="${AUDIT_YEARS:-}"
AUDIT_SESSION_TYPES_OVERRIDE="${AUDIT_SESSION_TYPES:-}"
INCLUDE_TELEMETRY_OVERRIDE="${INCLUDE_TELEMETRY:-}"
TELEMETRY_MODE_OVERRIDE="${TELEMETRY_MODE:-}"
RESUME_MODE_OVERRIDE="${RESUME_MODE:-}"
MAX_SESSIONS_OVERRIDE="${MAX_SESSIONS:-}"

set -a
source .env
set +a

[[ -n "$AUDIT_YEARS_OVERRIDE" ]] && AUDIT_YEARS="$AUDIT_YEARS_OVERRIDE"
[[ -n "$AUDIT_SESSION_TYPES_OVERRIDE" ]] && AUDIT_SESSION_TYPES="$AUDIT_SESSION_TYPES_OVERRIDE"
[[ -n "$INCLUDE_TELEMETRY_OVERRIDE" ]] && INCLUDE_TELEMETRY="$INCLUDE_TELEMETRY_OVERRIDE"
[[ -n "$TELEMETRY_MODE_OVERRIDE" ]] && TELEMETRY_MODE="$TELEMETRY_MODE_OVERRIDE"
[[ -n "$RESUME_MODE_OVERRIDE" ]] && RESUME_MODE="$RESUME_MODE_OVERRIDE"
[[ -n "$MAX_SESSIONS_OVERRIDE" ]] && MAX_SESSIONS="$MAX_SESSIONS_OVERRIDE"

export DISABLE_SQLALCHEMY_CEXT_RUNTIME="${DISABLE_SQLALCHEMY_CEXT_RUNTIME:-1}"

if [[ ! -d .venv ]]; then
  echo "Missing virtualenv at $ROOT_DIR/.venv"
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source .venv/bin/activate

trim() {
  local value="$1"
  # shellcheck disable=SC2001
  echo "$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
}

IFS=',' read -r -a YEARS_RAW <<< "${AUDIT_YEARS}"
YEARS=()
for y in "${YEARS_RAW[@]}"; do
  ty="$(trim "$y")"
  [[ -n "$ty" ]] && YEARS+=("$ty")
done
if [[ "${#YEARS[@]}" -eq 0 ]]; then
  YEARS=("2023" "2024" "2025")
fi

IFS=',' read -r -a SESSION_TYPES_RAW <<< "${AUDIT_SESSION_TYPES}"
SESSION_TYPES=()
for s in "${SESSION_TYPES_RAW[@]}"; do
  ts="$(trim "$s")"
  [[ -n "$ts" ]] && SESSION_TYPES+=("$ts")
done
if [[ "${#SESSION_TYPES[@]}" -eq 0 ]]; then
  SESSION_TYPES=("Race")
fi

cmd=(
  python3 -m src.extract_fastf1
  --years "${YEARS[@]}"
  --session-types "${SESSION_TYPES[@]}"
  --include-telemetry "${INCLUDE_TELEMETRY}"
  --telemetry-mode "${TELEMETRY_MODE}"
  --resume "${RESUME_MODE}"
)

if [[ -n "${MAX_SESSIONS:-}" ]]; then
  cmd+=(--max-sessions "${MAX_SESSIONS}")
fi

if [[ "$#" -gt 0 ]]; then
  cmd+=("$@")
fi

"${cmd[@]}"
