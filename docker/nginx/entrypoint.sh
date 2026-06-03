#!/usr/bin/env bash
# Replaces build-time placeholders with runtime env values so a single image
# works against any deployment URL.
set -euo pipefail

API_URL="${API_URL:-}"
ANON_KEY="${ANON_KEY:-}"

if [ -z "$API_URL" ]; then
  echo "[entrypoint] ERROR: API_URL env var must be set (e.g. http://localhost:8000)" >&2
  exit 1
fi
if [ -z "$ANON_KEY" ]; then
  echo "[entrypoint] ERROR: ANON_KEY env var must be set" >&2
  exit 1
fi

ROOT=/usr/share/nginx/html
echo "[entrypoint] Injecting API_URL=$API_URL into built bundle"

# Escape for sed
esc() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }

API_ESC=$(esc "$API_URL")
ANON_ESC=$(esc "$ANON_KEY")

# Only scan js/html/css for the placeholders
find "$ROOT" -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \) -print0 \
  | xargs -0 sed -i \
      -e "s|__RUNTIME_API_URL__|${API_ESC}|g" \
      -e "s|__RUNTIME_ANON_KEY__|${ANON_ESC}|g"

echo "[entrypoint] Done."
