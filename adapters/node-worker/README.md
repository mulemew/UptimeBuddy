# UptimeBuddy — Node worker adapter

Single small container that runs the check loop against your Postgres. Meant
as a lighter self-hosted alternative to the 7-container Supabase-mirror setup.

Supports every monitor type including **real ICMP ping** (the image installs
`iputils-ping` and grants `cap_net_raw`).

## Run with the slim compose

From the repo root:

```bash
docker compose -f docker-compose.slim.yaml up -d --build
```

Containers: `db` (Postgres), `app` (frontend), `worker` (this). No kong, no
edge-runtime, no realtime, no scheduler.

## Run standalone

Point it at any Postgres that already has the UptimeBuddy schema + a
`service_role` JWT (from Supabase or the self-hosted stack):

```bash
docker build -f adapters/node-worker/Dockerfile -t uptimebuddy-worker .
docker run --rm --cap-add NET_RAW \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  uptimebuddy-worker
```

## Env vars

| Name | Required | Default | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | — | Full URL to your Supabase REST endpoint. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | service_role JWT. |
| `CONCURRENCY` | | `20` | Max in-flight checks per tick. |
| `TICK_MS` | | `60000` | How often to run the loop. |
