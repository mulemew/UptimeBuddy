# UptimeBuddy

Self-hostable uptime monitoring for HTTP, TCP, ping, DNS, multi-step,
database and push (passive heartbeat) endpoints — with incidents,
maintenance windows, a public status page and a clean dashboard.

Built with **Vite + React + shadcn/ui** on the frontend and **PostgreSQL +
PostgREST + Realtime + Deno edge functions** on the backend. Originally
generated with [Lovable](https://lovable.dev); now runnable anywhere with
Docker — no Lovable / Supabase account required.

---

## One-click self-host

Requirements: Docker 24+ with the Compose plugin.

```bash
git clone https://github.com/mulemew/UptimeBuddy.git uptimebuddy
cd uptimebuddy
docker compose up -d
```

Then open <http://localhost:3000>. The very first request takes a moment
while Postgres initialises and migrations apply.

That's it — `docker compose up -d` works **with zero edits**. The compose
file ships with safe defaults baked in (and the same well-known demo JWT
keys Supabase uses for local development).

### Ports

| Service | URL                       | Override env  |
| ------- | ------------------------- | ------------- |
| Web UI  | http://localhost:3000     | `APP_PORT`    |
| API     | http://localhost:8000     | `KONG_PORT`   |

### Deploying on a remote server

Set `PUBLIC_API_URL` to the address your browser will use to reach the API
gateway, then bring the stack back up:

```bash
echo "PUBLIC_API_URL=http://uptime.example.com:8000" >> .env
docker compose up -d --force-recreate app
```

(That's the only change you need — the frontend image rewrites its bundle
on container start, so you don't have to rebuild.)

### Hardening for production

Defaults are PUBLIC and only suitable for trials / LAN. For production,
copy `.env.example` to `.env` and regenerate:

- `POSTGRES_PASSWORD` — any strong password
- `JWT_SECRET` — at least 32 random chars
- `ANON_KEY` — JWT signed with the secret, payload `{"role":"anon"}`
- `SERVICE_ROLE_KEY` — JWT signed with the secret, payload `{"role":"service_role"}`

Quick generator:

```bash
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
node -e "const j=require('jsonwebtoken');const s=process.env.JWT_SECRET;
console.log('ANON_KEY='+j.sign({role:'anon',iss:'self'},s));
console.log('SERVICE_ROLE_KEY='+j.sign({role:'service_role',iss:'self'},s));"
```

Put it behind a reverse proxy (Caddy / Traefik / nginx) for TLS.

---

## Architecture

```text
                       ┌──────────────────────────┐
 Browser ─── :3000 ──► │  app  (nginx + SPA)      │
                       └────────────┬─────────────┘
                                    │ HTTPS calls (PUBLIC_API_URL)
                       ┌────────────▼─────────────┐
                       │  kong  (api gateway :8000)│
                       └─┬───────┬────────┬───────┘
                         │       │        │
              /rest/v1   │       │ /realtime/v1
                         ▼       ▼        ▼ /functions/v1
                     postgrest realtime  functions (deno edge runtime)
                         │       │        │
                         └───────┴────┬───┘
                                      ▼
                                   postgres
                                      ▲
                                scheduler (cron → run-checks every 60s)
```

### Containers

Only **one** image is custom-built (the SPA bundle). Everything else uses
official upstream images with scripts/code mounted from the repo.

| Image                                              | Built by us? | Purpose                       |
| -------------------------------------------------- | ------------ | ----------------------------- |
| `ghcr.io/mulemew/uptimebuddy-app` (multi-arch)     | yes          | Frontend SPA + nginx          |
| `postgres:16-alpine`                               | no           | Database (init via volumes)   |
| `postgrest/postgrest:v12.2.0`                      | no           | REST over Postgres            |
| `supabase/realtime:v2.30.34`                       | no           | Postgres change streaming     |
| `supabase/edge-runtime:v1.58.2`                    | no           | Deno functions (code mounted) |
| `kong:3.4`                                         | no           | API gateway                   |
| `alpine:3.20`                                      | no           | 60s tick → `run-checks`       |

---

## Local development (without Docker)

```bash
bun install
bun run dev      # vite dev server
bun run test     # vitest
```

The dev server still talks to whatever backend `VITE_SUPABASE_URL` points
to. For a fully local loop, start just the backend services from compose
(`docker compose up -d db rest realtime functions kong scheduler`) and
set `VITE_SUPABASE_URL=http://localhost:8000` in `.env.local`.

---

## CI / Releases

`.github/workflows/docker.yml` builds and publishes the single
`uptimebuddy-app` image to GitHub Container Registry for
**linux/amd64** and **linux/arm64** on every push to `main` and every
`v*` tag. All other services run upstream images directly, so no extra
publishing is needed.

---

## License

MIT.
