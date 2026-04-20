# PromptGuard

PromptGuard detects semantic regressions in prompt behavior across commits. It evaluates prompt outputs with an LLM judge instead of string diff checks, and can run locally or through an API/worker pipeline for CI.

## Monorepo Layout

```text
apps/
  api-server/      Fastify + Prisma + BullMQ API
  worker/          Background evaluators for queued runs
  web-dashboard/   React dashboard for prompt/run visualization
packages/
  shared-types/    Shared contracts used across all apps
  llm-provider/    Provider abstraction (local/openai/mock)
  evaluator/       Core grading and drift scoring logic
  sdk/             Prompt registration + local registry helpers
  cli/             prompt-guard command runner
```

## Prerequisites

- Node.js 22+
- Corepack enabled (`corepack enable`)
- Docker (for local PostgreSQL/Redis)

## Quick Start

```bash
corepack pnpm install
docker compose up -d
```

### API + Worker

```bash
# In one terminal
corepack pnpm --filter @promptguard/api-server dev

# In another terminal
corepack pnpm --filter @promptguard/worker dev
```

### Local CLI Mode

```bash
corepack pnpm --filter prompt-guard build
corepack pnpm --filter prompt-guard exec prompt-guard test --base main
```

### Dashboard

```bash
corepack pnpm --filter @promptguard/web-dashboard dev
```

Set `VITE_PROMPTGUARD_API_URL` in `apps/web-dashboard/.env` if API is not at `http://127.0.0.1:4000`.

## Config Example

`promptguard.config.ts`

```ts
export default {
  threshold: 0.1,
  testsDir: "prompt_tests",
  generationModel: {
    provider: "local",
    model: "llama3"
  },
  judgeModel: {
    provider: "openai",
    model: "gpt-4o",
    apiKeyEnvVar: "OPENAI_API_KEY"
  }
};
```

## Test File Example

`prompt_tests/support.json`

```json
{
  "cases": [
    {
      "input": "Can I refund after 45 days?",
      "expect": "Rule: deny_refund"
    },
    {
      "input": "What are your business hours?",
      "expect": null
    }
  ]
}
```

## CI

A GitHub Actions template is available at `.github/workflows/promptguard.yml`.
