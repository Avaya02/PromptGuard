# PromptGuard — Full Project Build Specification (Super Prompt)

You are a senior software engineer tasked with building a production‑grade developer infrastructure tool named **PromptGuard**.

The goal: create a CI‑integrated framework that detects behavioral regressions in LLM prompts using semantic evaluation instead of string comparison.

The system must be modular, readable, scalable, and maintainable. Avoid monolithic files. Prefer small cohesive modules.

Use latest stable versions of all libraries and frameworks at implementation time.

Minimal comments — only 1‑2 line comments where intent is not obvious.

---

## Core Concept

PromptGuard allows developers to:

1. Register prompts in their codebase
2. Write behavioral test cases
3. Run local tests via CLI
4. Run CI checks automatically
5. Evaluate prompt changes using an LLM judge
6. Detect semantic regressions before deployment

The system must work fully locally by default (no external data sharing).

---

## High Level Architecture

Monorepo structure using pnpm workspaces:

```
promptguard/
  apps/
    web-dashboard/
    api-server/
    worker/
  packages/
    sdk/
    cli/
    evaluator/
    llm-provider/
    shared-types/
```

---

## Technology Stack

### General

* TypeScript (strict mode)
* Node.js LTS
* pnpm workspace
* ESLint + Prettier

### Database & Infra

* PostgreSQL
* Prisma ORM
* Redis
* BullMQ queues
* Docker for local services

### Backend API

* Fastify
* Zod validation

### Frontend

* React + Vite
* TailwindCSS
* TanStack Query
* Monaco Editor
* Recharts

### CLI

* Node CLI (yargs)
* Chalk
* Ora
* Execa

### AI Layer

* Default: local Ollama models
* Provider abstraction supports remote APIs later

---

## Functional Components

### 1. SDK Package (packages/sdk)

Purpose: allow developers to register prompts explicitly

Export:

```
definePrompt(name: string, content: string): RegisteredPrompt
```

Behavior:

* compute prompt hash
* track version changes
* emit metadata to runner via local registry file

Local registry file:

```
.promptguard/prompts.json
```

---

### 2. CLI Package (packages/cli)

Command:

```bash
npx prompt-guard test
# or with explicit baseline
npx prompt-guard test --base main
```

Flow (Standalone Local Mode):

1. Load config
2. Load registered prompts
3. Load test files
4. Run evaluator locally (in-memory execution)
5. Aggregate results
6. Print terminal report
7. Exit non-zero on failure

Flow (CI / Dashboard Mode - active if `PROMPTGUARD_API_URL` is set):

1. Send evaluation payload to API server
2. Worker processes jobs
3. Stream results back to CLI terminal
4. Exit non-zero on failure

Output must include:

* pass/fail per test
* latency & token usage stats
* regression score
* summary table

---

### 3. Config System

Create `promptguard.config.ts`

Example:

```typescript
export default {
  threshold: 0.1, // Max allowed failure rate
  testsDir: "prompt_tests",
  
  // Separation of generation vs evaluation models
  generationModel: {
    provider: "local",
    model: "llama3"
  },
  judgeModel: {
    provider: "openai", // Recommended for accurate grading
    model: "gpt-4o"
  }
}
```

---

### 4. Test File Format

Directory: `prompt_tests/`

JSON format supports both A/B Drift and Rubric Evaluation:

```json
{
  "cases": [
    {
      "input": "Can I refund after 45 days?",
      "expect": "Rule: deny_refund" // Rubric evaluation against expectations
    },
    {
      "input": "What are your business hours?",
      "expect": null // A/B Drift evaluation (baseline vs new response)
    }
  ]
}
```

---

### 5. Evaluator Package (packages/evaluator)

Core logic:

Steps:

1. Identify Baseline (Version A via git `--base` or API lookup)
2. Run prompt version A (skip if cached)
3. Run prompt version B (current code)
4. Send outputs (and optional `expect` rubric) to judge model
5. Compute regression result

Return structure:

```
{
  pass: boolean,
  driftScore: number,
  reason: string
}
```

---

### 6. LLM Provider Abstraction (packages/llm-provider)

Interface:

```
interface LLMProvider {
  generate(prompt: string, input: string): Promise<string>
  judge(context: JudgeInput): Promise<JudgeResult>
}
```

Implementations:

* LocalOllamaProvider (default)
* RemoteProvider (future)

---

### 7. Worker Service (apps/worker)

Responsibilities:

* consume evaluation jobs
* run evaluator
* store results in DB

Queue names:

```
prompt-run
judge-run
score-run
```

---

### 8. API Server (apps/api-server)

Routes:

```
POST /runs
GET /runs/:id
GET /runs/:id/results
GET /prompts
```

Responsibilities:

* store run metadata
* expose dashboard data

---

### 9. Database Schema

Tables:

prompts

* id
* name
* latest_version

prompt_versions

* id
* prompt_id
* commit_sha
* content
* hash
* created_at

runs

* id
* commit_sha
* environment (local, ci, prod)
* score
* status

results

* id
* run_id
* test_name
* pass
* drift_score
* reasoning
* latency_ms
* tokens_used

---

### 10. Web Dashboard (apps/web-dashboard)

Pages:

1. Prompt List
2. Run History
3. Test Result Viewer
4. Semantic Diff View

Features:

* compare outputs
* show reasoning
* regression graph

---

## Evaluation Logic

Judge prompt templates:

**Rubric Evaluation (if `expect` is set):**
```
Evaluate Response B against the following rubric: {expect_string}.
Does it satisfy the criteria without degradation?
Return JSON: {pass: boolean, reason: string, drift: number}
```

**A/B Drift Evaluation (if no `expect`):**
```
Compare baseline Response A to new Response B.
Determine whether Response B introduces incorrect behavior or unintended regression.
Return JSON: {pass: boolean, reason: string, drift: number}
```

Scoring:

```
driftScore = failedTests / totalTests
fail if driftScore > threshold
```

---

## CI Integration

Developers run:

```
npx prompt-guard test
```

CI exits with non‑zero code if regression detected.

---

## Coding Standards

* small modules (<200 lines)
* no circular dependencies
* strict typing everywhere
* avoid any implicit any
* functions < 40 lines when possible
* pure functions preferred

---

## Non Functional Requirements

* local‑first privacy
* deterministic JSON outputs
* idempotent test runs
* retryable workers

---

## Deliverables Order

1. shared-types
2. llm-provider (wrapper for LLMs)
3. evaluator (core grading logic)
4. sdk
5. cli basic runner (Standalone Local Mode)
6. **[Milestone: Working Local CLI over mock/local LLM]**
7. database integration
8. api server
9. worker queue
10. dashboard UI
11. CI example config

---

## Final Goal

Produce a working tool where a developer can:

```
npm install
npx prompt-guard init
npx prompt-guard test
```

And receive a semantic regression report for prompt changes.
