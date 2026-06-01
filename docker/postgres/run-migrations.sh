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

-- Read-only access for the SPA / public status page (anon role).
-- Adjust to taste if you want a fully private deployment.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['monitors','heartbeats','incidents','maintenance_windows','app_settings']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    END IF;
  END LOOP;
END$$;
SQL
