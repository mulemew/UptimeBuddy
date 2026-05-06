
ALTER TYPE public.monitor_status ADD VALUE IF NOT EXISTS 'degraded';

ALTER TABLE public.monitors
  ADD COLUMN IF NOT EXISTS http_method text NOT NULL DEFAULT 'GET',
  ADD COLUMN IF NOT EXISTS http_body text,
  ADD COLUMN IF NOT EXISTS http_body_type text,
  ADD COLUMN IF NOT EXISTS http_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS follow_redirects boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ignore_tls_errors boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cert_expiry_warn_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS match_mode text NOT NULL DEFAULT 'contains',
  ADD COLUMN IF NOT EXISTS degraded_threshold_ms integer;

UPDATE public.monitors SET match_mode = keyword_match::text WHERE keyword_match IS NOT NULL;

ALTER TABLE public.heartbeats
  ADD COLUMN IF NOT EXISTS cert_days_remaining integer;
