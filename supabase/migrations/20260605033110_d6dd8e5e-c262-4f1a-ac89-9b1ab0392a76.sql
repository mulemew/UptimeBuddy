
-- 1) Add missing cascade FK to maintenance_windows (orphan cleanup first)
DELETE FROM public.maintenance_windows mw
WHERE mw.monitor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.monitors m WHERE m.id = mw.monitor_id);

ALTER TABLE public.maintenance_windows
  ADD CONSTRAINT maintenance_windows_monitor_id_fkey
  FOREIGN KEY (monitor_id) REFERENCES public.monitors(id) ON DELETE CASCADE;

-- 2) Scheduler concurrency lock + retention config
CREATE TABLE IF NOT EXISTS public._uptimebuddy_runtime (
  key text PRIMARY KEY,
  ts  timestamptz NOT NULL DEFAULT now(),
  val text
);
GRANT SELECT ON public._uptimebuddy_runtime TO anon, authenticated;
GRANT ALL    ON public._uptimebuddy_runtime TO service_role;
ALTER TABLE public._uptimebuddy_runtime ENABLE ROW LEVEL SECURITY;

INSERT INTO public._uptimebuddy_runtime(key, ts, val)
  VALUES ('heartbeats_retention_days', now(), '90'),
         ('run_checks_lock', to_timestamp(0), null)
  ON CONFLICT DO NOTHING;

-- 3) Index to make retention DELETE fast
CREATE INDEX IF NOT EXISTS idx_heartbeats_checked_at ON public.heartbeats (checked_at);
