
-- Enums
create type public.monitor_type as enum ('http', 'tcp', 'ping', 'keyword');
create type public.monitor_status as enum ('up', 'down', 'pending');
create type public.keyword_match_type as enum ('contains', 'not_contains');

-- Monitors
create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type monitor_type not null,
  target text not null,
  interval_minutes integer not null default 5 check (interval_minutes >= 1 and interval_minutes <= 1440),
  timeout_seconds integer not null default 10 check (timeout_seconds >= 1 and timeout_seconds <= 60),
  keyword text,
  keyword_match keyword_match_type,
  expected_status_codes text not null default '200-299,300-399',
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_status monitor_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Heartbeats
create table public.heartbeats (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status monitor_status not null,
  response_time_ms integer,
  status_code integer,
  error_message text
);
create index idx_heartbeats_monitor_time on public.heartbeats(monitor_id, checked_at desc);

-- Incidents
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  reason text
);
create index idx_incidents_monitor on public.incidents(monitor_id, started_at desc);

-- Updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger monitors_updated_at before update on public.monitors
for each row execute function public.tg_set_updated_at();

-- RLS — single-user app, allow everyone (anon + authenticated) full access
alter table public.monitors enable row level security;
alter table public.heartbeats enable row level security;
alter table public.incidents enable row level security;

create policy "public all monitors" on public.monitors for all using (true) with check (true);
create policy "public all heartbeats" on public.heartbeats for all using (true) with check (true);
create policy "public all incidents" on public.incidents for all using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table public.heartbeats;
alter publication supabase_realtime add table public.monitors;
alter publication supabase_realtime add table public.incidents;

-- Cron: invoke run-checks every minute
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'uptime-run-checks',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://imwcpwuykdrzkjpclswz.supabase.co/functions/v1/run-checks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imltd2Nwd3V5a2RyemtqcGNsc3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjczNTMsImV4cCI6MjA5MzY0MzM1M30.A6vulcg6CEcFpleViLFAJ_Z2yumcHvMJXBkA4V3NPBY'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
