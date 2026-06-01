# ---------- build stage ----------
FROM oven/bun:1.1-alpine AS build
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Build with placeholders that get replaced at container runtime by docker/nginx/entrypoint.sh.
# This way the same image works against any deployment URL without rebuilding.
ENV VITE_SUPABASE_URL=__RUNTIME_API_URL__
ENV VITE_SUPABASE_PUBLISHABLE_KEY=__RUNTIME_ANON_KEY__
ENV VITE_SUPABASE_PROJECT_ID=self-hosted
RUN bun run build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine
RUN apk add --no-cache bash
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx/app.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

# Defaults — overridable in docker-compose
ENV API_URL=http://localhost:8000
ENV ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE

EXPOSE 80
