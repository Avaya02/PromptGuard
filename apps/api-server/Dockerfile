# Multi-stage build: the final image carries only production dependencies and
# compiled output, small enough for a 512 MB VPS.
FROM node:22-alpine AS base
# Prisma's query engine links against OpenSSL, which Alpine omits by default.
RUN apk add --no-cache openssl && corepack enable
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

RUN pnpm --filter @diditbreak/shared-types build \
 && pnpm --filter @diditbreak/llm-provider build \
 && pnpm --filter @diditbreak/evaluator build \
 && pnpm --filter @diditbreak/api-server build

# pnpm 10 only deploys non-injected workspace packages in legacy mode.
RUN pnpm --filter @diditbreak/api-server --prod deploy --legacy /tmp/api-server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /tmp/api-server ./
COPY --from=build /app/apps/api-server/prisma ./prisma
# deploy reinstalls from the lockfile, which drops the client generated in the
# build stage, so generate it again against this image's own node_modules.
RUN npx prisma generate --schema prisma/schema.prisma

EXPOSE 4000
# Migrations apply at start so `docker compose up` yields a usable schema.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]
