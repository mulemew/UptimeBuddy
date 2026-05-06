-- Convert existing keyword monitors to http
UPDATE public.monitors SET type = 'http' WHERE type = 'keyword';

-- Rebuild monitor_type enum without 'keyword'
ALTER TYPE public.monitor_type RENAME TO monitor_type_old;
CREATE TYPE public.monitor_type AS ENUM ('http', 'tcp', 'ping');
ALTER TABLE public.monitors
  ALTER COLUMN type TYPE public.monitor_type
  USING type::text::public.monitor_type;
DROP TYPE public.monitor_type_old;