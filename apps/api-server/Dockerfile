# Multi-stage build: the final image carries only production deps and dist
# output, keeping it small enough for a 512 MB VPS.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
# Manifests first so dependency layers cache across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/llm-provider/package.json ./packages/llm-provider/
COPY packages/evaluator/package.json ./packages/evaluator/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/cli/package.json ./packages/cli/
COPY apps/api-server/package.json ./apps/api-server/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web-dashboard/package.json ./apps/web-dashboard/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages ./packages
COPY apps/api-server ./apps/api-server

RUN pnpm --filter @promptguard/shared-types build \
 && pnpm --filter @promptguard/llm-provider build \
 && pnpm --filter @promptguard/evaluator build \
 && pnpm --filter @promptguard/api-server build

# Drop dev dependencies before copying into the runtime image.
RUN pnpm --filter @promptguard/api-server --prod deploy /tmp/api-server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /tmp/api-server ./
COPY --from=build /app/apps/api-server/prisma ./prisma

EXPOSE 4000
# Migrations run at start so `docker compose up` yields a usable schema.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]
