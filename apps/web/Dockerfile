# ---------- builder ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @telecrm/shared build
# Build-time env (API origin) — passed via build args so the bundle inlines it.
ARG NUXT_PUBLIC_API_URL
ARG NUXT_PUBLIC_WS_URL
ENV NUXT_PUBLIC_API_URL=$NUXT_PUBLIC_API_URL
ENV NUXT_PUBLIC_WS_URL=$NUXT_PUBLIC_WS_URL
RUN pnpm --filter @telecrm/web build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY --from=builder /repo/apps/web/.output ./.output

EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
