#!/usr/bin/env bash
set -u

# One-command production checks for LORE.
# Usage:
#   bash check-prod.sh
#   BASE_URL=https://lore.example.com bash check-prod.sh

BASE_URL="${BASE_URL:-}"
ENV_FILE="${ENV_FILE:-.env}"
DEPLOY_BLOCK="${INDEXER_START_BLOCK:-25663555}"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo "WARN: $1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

search_in_text() {
  local pattern="$1"
  if has_cmd rg; then
    rg -qi "$pattern"
  else
    grep -Eiq "$pattern"
  fi
}

pick_base_url() {
  if [[ -n "$BASE_URL" ]]; then
    echo "$BASE_URL"
    return
  fi
  local candidates=(
    "http://127.0.0.1:3000"
    "http://127.0.0.1:3001"
  )
  for c in "${candidates[@]}"; do
    if curl -sS --max-time 3 "$c/api/epochs" >/dev/null 2>&1; then
      echo "$c"
      return
    fi
  done
  # fallback: keep old default for deterministic output
  echo "http://127.0.0.1:3000"
}

json_get() {
  # json_get '<json>' '<python expr>'
  # Passes JSON via stdin to avoid "Argument list too long" on large payloads.
  local json="$1"
  local expr="$2"
  printf '%s' "$json" | python3 -c '
import json, sys
raw = sys.stdin.read()
expr = sys.argv[1]
try:
    data = json.loads(raw)
    safe_builtins = {
        "min": min,
        "max": max,
        "int": int,
        "str": str,
        "len": len,
    }
    result = eval(expr, {"__builtins__": safe_builtins}, {"data": data})
    if isinstance(result, (dict, list)):
        print(json.dumps(result))
    else:
        print("" if result is None else result)
except Exception:
    print("")
' "$expr"
}

echo "== LORE production check =="
BASE_URL="$(pick_base_url)"
echo "BASE_URL=$BASE_URL"
echo "ENV_FILE=$ENV_FILE"
echo "DEPLOY_BLOCK=$DEPLOY_BLOCK"
echo

###############################################################################
# 1) ENV check
###############################################################################
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  fail "ENV file not found: $ENV_FILE"
fi

if [[ -n "${KEEPER_PRIVATE_KEY:-}" ]]; then
  pass "KEEPER_PRIVATE_KEY is set"
else
  fail "KEEPER_PRIVATE_KEY is empty"
fi

if [[ -n "${KEEPER_CONTRACT_ADDRESS:-}" ]]; then
  pass "KEEPER_CONTRACT_ADDRESS is set"
else
  warn "KEEPER_CONTRACT_ADDRESS is empty (using default from config/publicConfig.ts)"
fi

if [[ -n "${NEXT_PUBLIC_CONTRACT_ADDRESS:-}" ]]; then
  pass "NEXT_PUBLIC_CONTRACT_ADDRESS is set"
else
  warn "NEXT_PUBLIC_CONTRACT_ADDRESS is empty (frontend will use default from config/publicConfig.ts)"
fi

if [[ -n "${NEXT_PUBLIC_LINEA_TOKEN_ADDRESS:-}" ]]; then
  pass "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS is set"
else
  warn "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS is empty (frontend will use default token address)"
fi

if [[ -n "${NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER:-}" ]]; then
  pass "NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER is set"
else
  warn "NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER is empty (frontend will infer legacy/v6 profile from contract address)"
fi

if [[ -n "${NEXT_PUBLIC_CONTRACT_HAS_REBATE_API:-}" ]]; then
  pass "NEXT_PUBLIC_CONTRACT_HAS_REBATE_API is set"
else
  warn "NEXT_PUBLIC_CONTRACT_HAS_REBATE_API is empty (frontend will infer rebate support from contract address)"
fi

if [[ -n "${NEXT_PUBLIC_FIREBASE_DATABASE_URL:-}" || -n "${FIREBASE_DB_URL:-}" ]]; then
  pass "Firebase URL is set"
else
  fail "Firebase URL is empty (NEXT_PUBLIC_FIREBASE_DATABASE_URL/FIREBASE_DB_URL)"
fi

###############################################################################
# 2) Process check (pm2/supervisor)
###############################################################################
if has_cmd pm2; then
  PM2_OUT="$(pm2 jlist 2>/dev/null || true)"
  if [[ -n "$PM2_OUT" ]] && [[ "$PM2_OUT" != "[]" ]]; then
    echo "$PM2_OUT" | search_in_text "\"status\":\"online\"" \
      && pass "PM2 has online processes" \
      || fail "PM2 found, but no online process"
  else
    fail "PM2 found, but process list is empty"
  fi
else
  warn "pm2 not found, checking process list"
  if ps aux | search_in_text "run-bot-forever|indexer|bot\.ts|node .*bot"; then
    pass "Bot/indexer-like process is running"
  else
    fail "No bot/indexer process detected"
  fi
fi

###############################################################################
# 3) API check
###############################################################################
if has_cmd curl; then
  EPOCHS_JSON="$(curl -sS --max-time 20 "$BASE_URL/api/epochs" || true)"
  JACKPOTS_JSON="$(curl -sS --max-time 20 "$BASE_URL/api/jackpots" || true)"
  HEALTH_JSON="$(curl -sS --max-time 20 "$BASE_URL/api/health/data-sync" || true)"
else
  fail "curl is not installed"
  EPOCHS_JSON=""
  JACKPOTS_JSON=""
  HEALTH_JSON=""
fi

if [[ -n "$EPOCHS_JSON" ]] && [[ "$EPOCHS_JSON" != *"error"* ]]; then
  pass "/api/epochs responds"
else
  fail "/api/epochs failed or returned error"
fi

if [[ -n "$JACKPOTS_JSON" ]] && [[ "$JACKPOTS_JSON" != *"error"* ]]; then
  pass "/api/jackpots responds"
else
  fail "/api/jackpots failed or returned error"
fi

if [[ -n "$HEALTH_JSON" ]] && [[ "$HEALTH_JSON" != *"error"* ]]; then
  pass "/api/health/data-sync responds"
else
  fail "/api/health/data-sync failed or returned error"
fi

###############################################################################
# 4) Freshness / old-data guard
###############################################################################
if [[ -n "$EPOCHS_JSON" ]]; then
  MIN_BLOCK="$(json_get "$EPOCHS_JSON" "min([int(v.get('resolvedBlock', '0')) for v in data.get('epochs', {}).values() if int(v.get('resolvedBlock', '0')) > 0] or [0])")"
  MAX_EPOCH="$(json_get "$EPOCHS_JSON" "max([int(k) for k in data.get('epochs', {}).keys()] or [0])")"

  if [[ -n "$MIN_BLOCK" ]] && [[ "$MIN_BLOCK" =~ ^[0-9]+$ ]] && [[ "$MIN_BLOCK" -ge "$DEPLOY_BLOCK" ]]; then
    pass "Epochs do not include pre-deploy resolvedBlock values"
  else
    fail "Epochs include old resolvedBlock (< deploy block) or cannot parse"
  fi

  if [[ -n "$MAX_EPOCH" ]] && [[ "$MAX_EPOCH" =~ ^[0-9]+$ ]] && [[ "$MAX_EPOCH" -gt 0 ]]; then
    pass "Epochs payload contains data (max epoch: $MAX_EPOCH)"
  else
    fail "Epochs payload is empty or invalid"
  fi
else
  fail "Skipped freshness check: /api/epochs unavailable"
fi

if [[ -n "$JACKPOTS_JSON" ]]; then
  JACKPOT_MIN_BLOCK="$(json_get "$JACKPOTS_JSON" "min([int(j.get('blockNumber', '0')) for j in data.get('jackpots', []) if str(j.get('blockNumber', '0')).isdigit() and int(j.get('blockNumber', '0')) > 0] or [0])")"
  if [[ -n "$JACKPOT_MIN_BLOCK" ]] && [[ "$JACKPOT_MIN_BLOCK" =~ ^[0-9]+$ ]] && [[ "$JACKPOT_MIN_BLOCK" -ge "$DEPLOY_BLOCK" ]]; then
    pass "Jackpots do not include pre-deploy blockNumber values"
  else
    fail "Jackpots include old blockNumber (< deploy block) or cannot parse"
  fi
else
  fail "Skipped jackpot freshness check: /api/jackpots unavailable"
fi

echo
echo "== RESULT =="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
