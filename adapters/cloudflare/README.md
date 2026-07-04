# UptimeBuddy — Cloudflare Workers adapter

Runs the monitor check loop on Cloudflare's global edge, on a 1-minute Cron
Trigger. Zero containers. Data lives in your Supabase / Postgres.

## Trade-offs

| Feature | Status |
|---|---|
| HTTP / HTTPS | ✅ |
| TCP port | ✅ (via `cloudflare:sockets`) |
| DNS | ✅ (via Cloudflare DoH) |
| Multi-step API | ✅ |
| Real ICMP ping | ❌ — Workers can't open raw sockets. Ping monitors will be marked down with a clear error message. Use the self-hosted node-worker for real ping. |
| Database monitor | ❌ — needs a persistent DB driver. Use self-hosted. |
| TLS cert expiry warning | ❌ — no raw TLS handshake API. |

## Deploy

```bash
cd adapters/cloudflare
bun install
wrangler login

# secrets (once)
wrangler secret put SUPABASE_URL                     # https://xxx.supabase.co
wrangler secret put SUPABASE_SERVICE_ROLE_KEY        # service_role JWT
wrangler secret put CRON_SECRET                      # optional, for manual /run

wrangler deploy
```

Cron trigger `* * * * *` is declared in `wrangler.toml` and starts firing after
the first deploy. You can also trigger a run manually:

```bash
curl -X POST https://uptimebuddy-checker.<subdomain>.workers.dev/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Coexistence with self-hosted / Lovable Cloud

Only one scheduler should be writing heartbeats for a given database. If you
enable the CF Worker, disable pg_cron's `run-checks` job (or don't deploy the
self-hosted `scheduler` container). Otherwise you'll get duplicate heartbeats.
