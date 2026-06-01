#!/bin/bash
# Runs after 00-init.sql. Applies every project migration in /docker-entrypoint-initdb.d/migrations
# in alphabetical (= timestamp) order, then GRANTs RW on all public tables to service_role
# (covers tables that didn't include explicit grants).
set -e

MIG_DIR=/docker-entrypoint-initdb.d/migrations
if [ -d "$MIG_DIR" ]; then
  for f in $(ls "$MIG_DIR" | sort); do
    echo "[migrations] applying $f"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$MIG_DIR/$f"
  done
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
SQL
