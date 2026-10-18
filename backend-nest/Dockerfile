# DioteKo backend-nest Dockerfile (NestJS + TypeORM)
FROM node:20-alpine

WORKDIR /app

# curl for healthcheck
RUN apk add --no-cache curl

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3003

# /api/healthz is a public liveness+DB probe (src/modules/healthz). Honours
# $PORT so a prod run with PORT=3000 is still checked correctly.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-3003}/api/healthz" || exit 1

CMD ["node", "dist/main.js"]
