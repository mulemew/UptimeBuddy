-- Drop overly-permissive policies
DROP POLICY IF EXISTS "public all monitors" ON public.monitors;
DROP POLICY IF EXISTS "public all heartbeats" ON public.heartbeats;
DROP POLICY IF EXISTS "public all incidents" ON public.incidents;

-- Keep public read access (public status page relies on this)
CREATE POLICY "public read monitors" ON public.monitors
  FOR SELECT USING (true);

CREATE POLICY "public read heartbeats" ON public.heartbeats
  FOR SELECT USING (true);

CREATE POLICY "public read incidents" ON public.incidents
  FOR SELECT USING (true);

-- Note: writes are intentionally not granted to anon/auth roles.
-- All mutations now flow through edge functions using the service role,
-- which bypasses RLS and verifies the admin session token in code.