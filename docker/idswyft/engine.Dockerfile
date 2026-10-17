# Idswyft ML engine, built from the pinned upstream release PLUS the DioteKo overlay.
#
# Based on engine/Dockerfile of Idswyft v1.12.19 (MIT License, Copyright (c) 2025-present Team Idswyft).
# What differs from upstream:
#   - the sources come from the build context named `upstream` (docker-compose.idswyft.yml points it at the release tag)
#     instead of being the main context, so that our `overlay/` can be laid over them;
#   - two extra steps copy `overlay/shared/src/` over the upstream shared sources and `overlay/engine/src/` over the
#     upstream engine sources (see docker/idswyft/README.md).
# Everything else is the upstream file, unchanged.

# ── Stage 1: Build ──────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Native build dependencies (needed to compile canvas, sharp, onnxruntime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    wget \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace root + package manifests (for npm workspace resolution)
COPY --from=upstream package.json ./
COPY --from=upstream shared/package.json shared/
COPY --from=upstream engine/package.json engine/

# Install all dependencies (npm workspaces resolves @idswyft/shared)
RUN npm install --include=optional

# Copy pre-generated models (e.g., deepfake-detector.onnx from export script)
COPY --from=upstream shared/models/ shared/models/

# Download face detection + deepfake model weights
ARG GITHUB_TOKEN
COPY --from=upstream engine/download-models.js engine/
RUN cd engine && GITHUB_TOKEN=${GITHUB_TOKEN} node download-models.js

# Build shared package first (engine depends on it)
COPY --from=upstream shared/src/ shared/src/
COPY overlay/shared/src/ shared/src/
COPY --from=upstream shared/tsconfig.json shared/
RUN cd shared && npx tsc && npx tsc-alias

# Copy engine source, then lay the DioteKo overlay over it, and compile TypeScript
COPY --from=upstream engine/src/ engine/src/
COPY overlay/engine/src/ engine/src/
COPY --from=upstream engine/tsconfig.json engine/
RUN cd engine && npx tsc && npx tsc-alias

# Strip devDependencies — only production deps go to runtime stage
RUN npm prune --omit=dev

# ── Stage 2: Runtime ────────────────────────────────
FROM node:20-slim
WORKDIR /app/engine

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgif7 \
    librsvg2-2 \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with home directory (PaddleOCR caches models in ~/.cache)
RUN groupadd -r nodeuser && useradd -r -g nodeuser -m -s /bin/false nodeuser \
    && mkdir -p /home/nodeuser/.cache/ppu-paddle-ocr \
    && chown -R nodeuser:nodeuser /home/nodeuser

# Copy compiled output preserving workspace structure for @idswyft/shared resolution
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/engine/dist ./dist
COPY --from=build /app/engine/models ./models
COPY --from=build /app/shared/dist /app/shared/dist
COPY --from=build /app/shared/models /app/shared/models
COPY --from=build /app/shared/package.json /app/shared/package.json
COPY --from=build /app/engine/package.json ./package.json

RUN chown -R nodeuser:nodeuser /app
USER nodeuser

EXPOSE 3002

CMD ["node", "dist/server.js"]
