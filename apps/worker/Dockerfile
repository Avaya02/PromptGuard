FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

FROM base AS build
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
# The worker's Prisma client is generated from the api-server schema.
COPY apps/api-server/prisma ./apps/api-server/prisma
COPY apps/worker ./apps/worker

RUN pnpm --filter @promptguard/shared-types build \
 && pnpm --filter @promptguard/llm-provider build \
 && pnpm --filter @promptguard/evaluator build \
 && pnpm --filter @promptguard/worker build

RUN pnpm --filter @promptguard/worker --prod deploy --legacy /tmp/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /tmp/worker ./
COPY --from=build /app/apps/api-server/prisma ./prisma
RUN npx prisma generate --schema prisma/schema.prisma

CMD ["node", "dist/index.js"]
