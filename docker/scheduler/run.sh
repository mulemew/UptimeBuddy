#!/usr/bin/env bash
# Tiny scheduler: hits run-checks every minute. Replaces pg_cron.
# Runs inside curlimages/curl:8.10.1 so curl is preinstalled — no apk add.
set -u

TARGET="${RUN_CHECKS_URL:-http://kong:8000/functions/v1/run-checks}"
TOKEN="${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}"
INTERVAL="${TICK_SECONDS:-60}"

echo "[scheduler] tick interval: ${INTERVAL}s, target: $TARGET"

while true; do
  start=$(date +%s)
  code=$(curl -s -o /tmp/last.out -w "%{http_code}" \
    -X POST "$TARGET" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --max-time 55 || echo "000")
  echo "[scheduler] $(date -u +%FT%TZ) status=$code"
  if [ "$code" != "200" ] && [ "$code" != "000" ]; then
    head -c 500 /tmp/last.out 2>/dev/null; echo
  fi
  elapsed=$(( $(date +%s) - start ))
  remain=$(( INTERVAL - elapsed ))
  [ $remain -lt 1 ] && remain=1
  sleep $remain
done
