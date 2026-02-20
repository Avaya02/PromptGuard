# PromptGuard — Implementation Roadmap

This document outlines the step-by-step build plan for the PromptGuard project. It is designed to be executed sequentially by a coding agent.

## Phase 1: Monorepo Foundation & Core Packages
**Goal:** Establish the pnpm workspace and build the shared utility packages.

### Step 1.1: Project Initialization
- Create the root directory `promptguard` (or use existing).
- Initialize a `pnpm` workspace with `pnpm init`.
- Create `pnpm-workspace.yaml` defining `packages/*` and `apps/*`.
- Set up root `tsconfig.json` for base TypeScript configuration.
- Set up ESLint and Prettier at the root level.
- Create a basic `promptguard.config.ts` blueprint.

### Step 1.2: `shared-types` Package (`packages/shared-types`)
- **Action:** Initialize `packages/shared-types` with `pnpm init` and `tsc --init`.
- **Implement:** 
  - Define core interfaces: `RegisteredPrompt`, `JudgeInput`, `JudgeResult`, `TestCases`, `EvaluationResult`, `PromptGuardConfig`.
  - Export all types from `src/index.ts`.
- **Build:** Add a build script (using `tsc`) to compile types and emit declarations.

### Step 1.3: `llm-provider` Package (`packages/llm-provider`)
- **Action:** Initialize `packages/llm-provider`. Add cross-workspace dependency on `shared-types`.
- **Implement:**
  - Create the `LLMProvider` abstract interface.
  - Implement `LocalOllamaProvider` (using `fetch` to default Ollama port `11434` or the Ollama SDK).
  - Implement an `OpenAIProvider` for the judge model default.
  - Implement a mock provider (`MockProvider`) for initial unit testing.
  - Ensure the providers implement both `generate(prompt, input)` and `judge(context)`.
- **Build:** Add `tsc` build script and export providers.

## Phase 2: Evaluation & CLI (Standalone Mode)
**Goal:** Build the core logic to evaluate prompts and the CLI to run tests locally without a database.

### Step 2.1: `evaluator` Package (`packages/evaluator`)
- **Action:** Initialize `packages/evaluator`. Add dependencies on `shared-types` and `llm-provider`.
- **Implement:**
  - `runEvaluation(versionA, versionB, testCases, config)`: The orchestrator.
  - System prompts for both **Rubric Evaluation** (if `expect` is provided) and **A/B Drift Evaluation** as defined in `guide.md`.
  - Logic to format outputs mapped to the specific judge model.
  - Result aggregation (calculating drift score, tokens used, latency, and pass/fail status).

### Step 2.2: `sdk` Package (`packages/sdk`)
- **Action:** Initialize `packages/sdk`. Add dependencies on `shared-types`.
- **Implement:**
  - `definePrompt(name, content)`: Hashes content, writes to local registry `.promptguard/prompts.json`.
  - Helpers to read the registry for the CLI during execution.

### Step 2.3: `cli` Package (`packages/cli`) - Core Runner
- **Action:** Initialize `packages/cli`. Add dependencies on `yargs`, `chalk`, `ora`, `execa`, `shared-types`, `evaluator`, `llm-provider`.
- **Implement:**
  - Create CLI entrypoint (e.g., `bin/prompt-guard.ts`).
  - Implement Command: `test [--base <branch/commit>]`.
  - Build Config loader: Parse `promptguard.config.ts`.
  - Build Test loader: Parse test files from `testsDir` (`prompt_tests/`).
  - Orchestration: Resolve baseline prompt, instantiate the `generationModel` and `judgeModel`, and call the `evaluator`.
  - Reporter module: Output a formatted success/failure table to terminal with drift scores and failure reasons.
- **Milestone Check:** Verify `npx prompt-guard test` works fully end-to-end locally with Ollama/mock models.

## Phase 3: Infrastructure & Backend
**Goal:** Set up persistent storage, background processing, and the API server for CI tracking.

### Step 3.1: Database Setup
- **Action:** Create `apps/api-server`. Initialize `prisma`.
- **Implement:**
  - Create `schema.prisma` with defined models: `Prompt`, `PromptVersion`, `Run`, `Result`. (Include `environment`, `commit_sha`, `latency_ms`, `tokens_used`).
  - Create `docker-compose.yml` at the project root for PostgreSQL and Redis.
  - Seed baseline data if necessary. Apply first migrations.

### Step 3.2: `api-server` (Apps)
- **Action:** Initialize Fastify in `apps/api-server`. Add dependencies: `@prisma/client`, `zod`, `fastify`, `bullmq`.
- **Implement:**
  - `POST /runs`: Accept test payload from CLI, create Run record, enqueue evaluation jobs to BullMQ.
  - `GET /runs/:id`, `GET /prompts`, `GET /prompts/:id/runs`: Read APIs for the dashboard.
- **Integration:** Initialize and export BullMQ queues (`prompt-run`, `judge-run`).

### Step 3.3: `worker` Service (`apps/worker`)
- **Action:** Initialize `apps/worker`. Add dependencies: `bullmq`, `evaluator`, `llm-provider`, `@prisma/client`.
- **Implement:**
  - Connect to Redis.
  - Worker for `prompt-run` queue (execute missing generations).
  - Worker for `judge-run` queue (submit prompt pairs to judge model).
  - DB updater utility: Write completed reasoning and drift scores to `Result` table via Prisma.

### Step 3.4: CLI CI Integration
- **Action:** Switch to `packages/cli`.
- **Implement:**
  - Update `test` command: Check if `PROMPTGUARD_API_URL` environment variable exists.
  - If existing, bypass local evaluator. Send `POST /runs` to API with current test cases and branch info.
  - Implement a polling mechanism (`ora` spinner) to wait for `GET /runs/:id` to reach a `completed` status.
  - Print the remote results to the local terminal.

## Phase 4: Frontend & Final Polish
**Goal:** Build the web dashboard to visualize test runs and regressions.

### Step 4.1: `web-dashboard` (`apps/web-dashboard`)
- **Action:** Initialize React + Vite app with TailwindCSS. Add dependencies: `react-router-dom`, `@tanstack/react-query`, `recharts`, `lucide-react`, `monaco-editor`.
- **Implement:**
  - Setup UI components (Containers, Tables, Cards, Badges).
  - Route: **Prompts List** (Grid/Table of all prompts and their latest drift status).
  - Route: **Prompt Detail** (Line chart showing drift score over time using Recharts, list of historical runs).
  - Route: **Run Result Viewer** (Specific commit run. Show a diff view for prompt changes, and expandable cards for individual test failures w/ Judge reasoning).

### Step 4.2: CI Example & Documentation
- **Action:** Provide usage documentation.
- **Implement:**
  - Write `.github/workflows/promptguard.yml` providing a GitHub Action template.
  - Write standard `README.md` containing CLI setup, config examples, and architecture overview.

---
## Agent Execution Guidelines
When executing this plan:
1. **Pacing:** Complete one step fully, including unit tests and types, before moving to the next.
2. **Build Verification:** Run `pnpm build` across the workspace after completing each package to ensure types sync correctly.
3. **Module Size:** Adhere to the `<200 lines` file size rule defined in `guide.md`. Break complex logic into smaller utils.
4. **Error Handling:** Use Zod for runtime validation heavily at package boundaries (SDK args, CLI config loading, API payloads).
