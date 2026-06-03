# ---------- build stage ----------
FROM oven/bun:1.1-alpine AS build
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Build with placeholders that get replaced at container runtime by
# docker/nginx/entrypoint.sh. This way the same image works against any
# deployment URL without rebuilding.
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

# API_URL / ANON_KEY are intentionally NOT defaulted here — docker-compose.yaml
# owns the defaults so we don't have three copies of the demo keys to keep in
# sync. The entrypoint will error loudly if either is unset.

EXPOSE 80
