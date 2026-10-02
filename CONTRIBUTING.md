# Contributing to diditbreak

## Setup

Requires Node 22+ and pnpm via corepack.

```bash
corepack enable
corepack pnpm install
corepack pnpm -r build     # packages must be built before apps typecheck
```

Workspace packages resolve through `dist/`, so a fresh clone needs `build` before `typecheck` will pass in `apps/`.

### Services

```bash
docker compose up -d postgres redis
cp apps/api-server/.env.example apps/api-server/.env
cp apps/worker/.env.example apps/worker/.env
corepack pnpm --filter @diditbreak/api-server prisma:migrate
corepack pnpm --filter @diditbreak/api-server seed
```

Postgres is published on host port **5433** to avoid colliding with a local install. Inside the compose network it is still 5432 — both `.env.example` files use 5433 because they are for processes running on the host.

### Running locally

```bash
corepack pnpm --filter @diditbreak/api-server dev
corepack pnpm --filter @diditbreak/worker dev
corepack pnpm --filter @diditbreak/web-dashboard dev
```

## Verification

Everything must pass before a PR:

```bash
corepack pnpm -r typecheck
corepack pnpm -r lint
corepack pnpm -r build
corepack pnpm -r test
```

## Tests

Vitest, colocated as `*.test.ts` beside the code, or under `test/` for app-level integration suites.

**Coverage thresholds are enforced per package** (75% lines/functions/statements, 70% branches) in `vitest.shared.ts`. A package failing its threshold fails the build. Thresholds are per-package deliberately: strong coverage in one package must not mask a gap in another.

### What to test where

| Layer | Approach |
|---|---|
| Pure logic (assertions, parsing, hashing, pricing) | Direct unit tests |
| Providers | `globalThis.fetch` stubbed; assert on request shape and retry behaviour |
| API routes | Fastify `inject()` against the in-memory Prisma double in `apps/api-server/test/fake-prisma.ts` |
| Worker | Same Prisma double, calling job processors directly |
| Agent experiments | Real git worktrees in temp dirs with the seeded mock agent; the Claude Code parser runs against a real, scrubbed transcript in `packages/agent-eval/test/fixtures/` |

The Prisma double keeps the suite runnable with no Docker and no database, which is what lets CI run at zero cost. It implements only the queries the routes actually issue — extend it when you add a query rather than reaching for a real database.

**Never call a real LLM API in a test.** `MockProvider` is deterministic and offline. Tests run without API keys set, so a provider requiring one will throw — which is the intended signal.

## Conventions

- **Contracts live in `packages/shared-types`.** If a payload changes, change it there first and let the compiler find the call sites.
- **Module size:** keep source files under ~200 lines. Past that, split by responsibility — the existing `runner/`, `providers/`, `utils/` splits are the pattern.
- **One export per concern.** Route registration, job processing, and persistence stay in separate modules.
- **Comment the "why".** The codebase explains non-obvious decisions (why deterministic checks short-circuit, why `startedAt` is guarded against races). It does not narrate what the code plainly does.
- **Strict TypeScript.** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Prefer conditional spreads (`...(x !== undefined ? { x } : {})`) over passing `undefined`.

## Adding a provider

1. Implement `LLMProvider` in `packages/llm-provider/src/providers/`.
2. Wrap requests in `withRetry` and throw `HttpError` on non-2xx so retry logic can see the status.
3. Add pricing to `utils/pricing.ts` if published.
4. Register it in `create-provider.ts` and `SUPPORTED_PROVIDERS`.
5. Add it to the `init` presets in `packages/cli/src/commands/init-command.ts`.
6. Test against a stubbed `fetch` — request shape, token accounting, and retry.
7. Update the provider table in the README.

## Database changes

```bash
# Edit apps/api-server/prisma/schema.prisma, then:
corepack pnpm --filter @diditbreak/api-server exec prisma migrate dev --name your_change
```

Migrations are checked in and applied with `prisma migrate deploy` on container start. Never edit an applied migration; add a new one.

## CI

Three jobs, all on the GitHub Actions free tier with no paid API calls:

- **quality** — typecheck, lint, build, unit tests with coverage
- **integration** — real PostgreSQL and Redis services; applies migrations, seeds, runs API and worker suites
- **regression-demo** — scaffolds a project with `init`, then runs the CLI end to end on MockProvider

If a change needs a real provider key, gate it behind an explicit secret check so forks and PRs still pass.

## The demo project

`examples/context-demo` is the source for `diditbreak init --demo`. After editing it, run `node scripts/sync-demo.mjs` to re-embed it in the CLI; a test fails if the two drift apart.

Never run real agents in tests. Use the mock agent, or the fake `claude` binaries the adapter tests build.
