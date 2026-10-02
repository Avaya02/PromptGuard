FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

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
COPY apps/web-dashboard ./apps/web-dashboard

RUN pnpm --filter @diditbreak/shared-types build \
 && pnpm --filter @diditbreak/web-dashboard build

# Static assets need no Node runtime; nginx keeps the image tiny.
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web-dashboard/dist /usr/share/nginx/html
COPY apps/web-dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
