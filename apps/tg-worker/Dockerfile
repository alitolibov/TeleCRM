# ---------- builder ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/tg-worker/package.json apps/tg-worker/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY apps/tg-worker apps/tg-worker

RUN pnpm --filter @telecrm/shared build && pnpm --filter @telecrm/tg-worker build
RUN pnpm --filter @telecrm/tg-worker deploy --prod --legacy /out

# ---------- runner ----------
# Glibc-based image — prebuilt-tdlib ships glibc binaries
FROM node:20-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 zlib1g ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json

# TDLib's local store (binlog, downloaded files) lives here — mount as volume
VOLUME /data

CMD ["node", "dist/index.js"]
