# ---------- builder ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Copy lockfile + manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy sources and build
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @telecrm/shared build && pnpm --filter @telecrm/api build

# Strip dev deps
RUN pnpm --filter @telecrm/api deploy --prod --legacy /out

# ---------- runner ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json
# drizzle SQL migrations — applied at first boot via `node dist/db/migrate.js`
COPY --from=builder /repo/apps/api/migrations ./migrations

EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/main.js"]
