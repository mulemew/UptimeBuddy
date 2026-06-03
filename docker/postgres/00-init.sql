-- Bootstrap: roles, schemas, extensions required by PostgREST / Realtime.
-- Runs once on first container start (placed in /docker-entrypoint-initdb.d/).
--
-- NOTE: $POSTGRES_PASSWORD is exported by the official postgres entrypoint
-- before .sh / .sql scripts run, so we can interpolate it via a bash wrapper.
-- This SQL file is invoked directly by the entrypoint; the authenticator
-- password is synced afterwards by run-migrations.sh (see ALTER ROLE there).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PostgREST roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    -- Placeholder password; run-migrations.sh resets it to $POSTGRES_PASSWORD.
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'placeholder-overwritten-on-init';
  END IF;
END$$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- Stub auth schema (some migrations may reference auth.uid())
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Realtime schema. The publication is created EMPTY (not FOR ALL TABLES) so
-- that project migrations can `ALTER PUBLICATION supabase_realtime ADD TABLE`
-- without colliding ("relation is already member of publication").
CREATE SCHEMA IF NOT EXISTS _realtime;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END$$;
-- wal_level is set via the postgres command line in docker-compose.yaml.
