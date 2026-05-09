-- Extend monitor_type enum
ALTER TYPE monitor_type ADD VALUE IF NOT EXISTS 'dns';
ALTER TYPE monitor_type ADD VALUE IF NOT EXISTS 'multistep';
ALTER TYPE monitor_type ADD VALUE IF NOT EXISTS 'database';
ALTER TYPE monitor_type ADD VALUE IF NOT EXISTS 'push';

-- Add new monitor columns
ALTER TABLE public.monitors
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_interval_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS dns_record_type text,
  ADD COLUMN IF NOT EXISTS dns_resolver text,
  ADD COLUMN IF NOT EXISTS dns_expected_values text[],
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS db_kind text,
  ADD COLUMN IF NOT EXISTS db_secret_name text,
  ADD COLUMN IF NOT EXISTS db_query text DEFAULT 'SELECT 1',
  ADD COLUMN IF NOT EXISTS push_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS push_grace_seconds integer NOT NULL DEFAULT 60;

ALTER TABLE public.heartbeats
  ADD COLUMN IF NOT EXISTS step_name text;

-- Maintenance windows
CREATE TABLE IF NOT EXISTS public.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  recurrence text NOT NULL DEFAULT 'none',
  weekday integer NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read maintenance" ON public.maintenance_windows;
CREATE POLICY "public read maintenance" ON public.maintenance_windows FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_maintenance_monitor ON public.maintenance_windows(monitor_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_window ON public.maintenance_windows(starts_at, ends_at);