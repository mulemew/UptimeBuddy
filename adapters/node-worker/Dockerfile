# Slim Node worker with real ICMP ping.
FROM node:20-slim

# iputils-ping provides /bin/ping; libcap2-bin provides setcap.
# `cap_net_raw+ep` on the ping binary lets the non-root `node` user open
# raw sockets without needing the whole container to run as root. The
# docker-compose file additionally adds NET_RAW to the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping libcap2-bin \
  && setcap cap_net_raw+ep /bin/ping \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root + checker-core + adapter (paths relative to repo root
# when using the compose build context = ".").
COPY package.json bun.lockb* ./
COPY packages/checker-core ./packages/checker-core
COPY adapters/node-worker ./adapters/node-worker

# Install just the adapter's deps (no bun in slim; use npm).
WORKDIR /app/adapters/node-worker
RUN npm install --omit=optional --no-audit --no-fund --loglevel=error

USER node
CMD ["npx", "-y", "tsx", "src/index.ts"]
