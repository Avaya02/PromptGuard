# api-server

Fastify API for the self-hosted diditbreak service: accepts runs from the CLI
(`DIDITBREAK_API_URL`), persists them to PostgreSQL via Prisma, and enqueues
evaluation jobs on BullMQ for the worker. Also serves the dashboard's data and a
server-sent event stream for live run progress.

```bash
cp .env.example .env
corepack pnpm --filter @diditbreak/api-server dev
```
