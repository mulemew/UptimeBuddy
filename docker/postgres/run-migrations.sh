#!/bin/bash
# Runs after 00-init.sql. Steps:
#   1. Sync authenticator role password with the runtime $POSTGRES_PASSWORD
#      (so PostgREST can log in when the user customises the password).
#   2. Apply every project migration in /docker-entrypoint-initdb.d/migrations
#      in alphabetical (= timestamp) order.
#   3. GRANT RW on all public tables to service_role (covers tables whose
#      migrations didn't include explicit grants) and open SELECT on a few
#      well-known tables to anon for the public status page.
#   4. Create a readiness sentinel table dependent services can poll on.
set -e

PGP="${POSTGRES_PASSWORD:-postgres}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v authpw="$PGP" <<'SQL'
\set authpw_quoted '\'' :authpw '\''
-- ALTER ROLE doesn't accept parameters; build the statement dynamically.
SELECT format('ALTER ROLE authenticator WITH PASSWORD %L', :'authpw') \gset
:value
SQL

# The HEREDOC trick above is fragile across psql versions; do it the simple way:
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "ALTER ROLE authenticator WITH PASSWORD '$PGP';"

MIG_DIR=/docker-entrypoint-initdb.d/migrations
if [ -d "$MIG_DIR" ]; then
  for f in "$MIG_DIR"/*.sql; do
    [ -e "$f" ] || continue
    echo "[migrations] applying $(basename "$f")"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  done
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- Read-only access for the SPA / public status page (anon role).
DO $$
DECLARE
  t text;
  pol_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY['monitors','heartbeats','incidents','maintenance_windows','app_settings']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
      pol_name := t || '_selfhost_public_read';
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=pol_name
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
          pol_name, t
        );
      END IF;
    END IF;
  END LOOP;
END$$;

-- Readiness sentinel: healthcheck polls this so dependents only start
-- after migrations + grants have finished.
CREATE TABLE IF NOT EXISTS public._uptimebuddy_ready (ready boolean PRIMARY KEY DEFAULT true);
INSERT INTO public._uptimebuddy_ready (ready) VALUES (true) ON CONFLICT DO NOTHING;
GRANT SELECT ON public._uptimebuddy_ready TO anon, authenticated, service_role;
SQL

echo "[migrations] done — sentinel public._uptimebuddy_ready created"
