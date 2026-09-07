# Workers image (oracle/creator/council/sync/traders + Sibyl sidecar).
# The web service builds from Dockerfile.web instead.
# ponytail: trixie ships SQLite 3.46; Sibyl search_shadow needs FTS5 trigram
# remove_diacritics (3.45+), which bookworm 3.40 rejects at open time.
FROM node:22-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# ponytail: pin npm to the version that wrote package-lock.json; npm 11+ rejects it
RUN npm i -g npm@10.9.3 && npm ci --omit=dev
COPY sibyl/requirements.txt ./sibyl/requirements.txt
RUN python3 -m venv /opt/sibyl-venv \
    && /opt/sibyl-venv/bin/pip install --no-cache-dir -r sibyl/requirements.txt \
    && /opt/sibyl-venv/bin/python -c "from sibyl_memory_client import MemoryClient"
COPY . .
ENV NODE_ENV=production \
    SIBYL_VENV=/opt/sibyl-venv \
    SIBYL_MEMORY_DB=/data/sibyl/memory.db \
    SIBYL_MEMORY_HOST=127.0.0.1 \
    SIBYL_REQUIRED=1 \
    SIBYL_EVENT_LOG=0 \
    SIBYL_NEON_ARCHIVE=0
CMD ["node", "scripts/start-workers.mjs"]
