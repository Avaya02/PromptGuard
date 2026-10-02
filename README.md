# diditbreak

[![CI](https://github.com/Avaya02/PromptGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/Avaya02/PromptGuard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/diditbreak)](https://www.npmjs.com/package/diditbreak)

**Did your CLAUDE.md change make your coding agent better or worse?**

Teams keep editing the files that steer their coding agents: `CLAUDE.md`, `AGENTS.md`, skills, MCP servers. Nobody can tell whether an edit helped, made the agent more confused, or just made every task more expensive. diditbreak runs your real tasks in fresh sandboxes under each setup, several times each, and measures the difference.

It matters because the obvious assumption ("more instructions help") is often wrong. An [ETH Zurich study](https://arxiv.org/abs/2602.11988) found that LLM-generated `AGENTS.md` files *lowered* task success by about 3% and raised costs by over 20%. Even hand-written ones raised costs by up to 19%.

## Try it in a minute

```bash
npx diditbreak init --demo        # a tiny repo with a CLAUDE.md edit to test
cd diditbreak-demo
npx diditbreak compare --agent mock   # free and offline (simulated numbers)
npx diditbreak compare                # real Claude Code runs; asks before spending
```

## A real result

The demo project's committed `CLAUDE.md` is short and correct: *run tests with `node --test`, no dependencies*. The edit pastes 41 lines of generic team-wiki guidelines on top, including *"all tests must use Jest"*. These are 12 real Claude Code runs (haiku), not a simulation:

```
 diditbreak · claude-code (haiku) · 2 tasks × 2 trials · 12 runs · 1m 49s

 setup    solved         cost/run  turns  context  time/run
 none       4/4  100%    $0.025    3.0    18.3k    9s
 HEAD       4/4  100%    $0.049    9.0    18.5k    22s
 working    3/4   75%    $0.067    11.0   18.9k    38s

 vs HEAD
   none     ±0 pts    (95% CI ±0 … ±0 pts)         no clear difference
            cost −49% · turns −67% · starting context −193 tokens
   working  −25 pts   (95% CI −75 … ±0 pts)        no clear difference
            cost +36% · turns +22% · starting context +450 tokens

 Rules broken  (runs that broke the rule / runs)
   forbid_command npm install  none 0/4   HEAD 0/4   working 1/4
                               e.g. ran: npm install --save-dev jest

 Blocked actions  (attempts the agent's permissions refused)
   working  3

 Total cost $0.567
```

What it shows:
- **The edit confused the agent.** Following the wiki, it tried `npm install --save-dev jest` against the project's "no dependencies" rule, and wrote tests under a third naming convention neither file asked for.
- **It made every task more expensive:** 36% more cost and 22% more turns.
- **Even good context has a price.** The correct `CLAUDE.md` doubled the cost compared with no file, because the agent did what it said and wrote and ran tests. That trade-off is now a number instead of a guess.
- **The verdict stays honest.** One failure in four runs is not proof, so it reports *no clear difference* with the interval, rather than *worse*. More trials narrow it.

## What it measures

| Question | Signal | Source |
|---|---|---|
| Does the agent succeed? | your `verify` commands pass | the sandbox, after the agent finishes |
| Is it overwhelmed? | cost, turns, time, and **starting context**: tokens carried into the first model call before any work | the agent's own run report |
| Is it confused? | forbidden commands, skills invoked or missed, actions its permissions refused | the agent's transcript |

## Commands

| Command | |
|---|---|
| `diditbreak init` | Set up experiments in this repo: config and an example task |
| `diditbreak init --demo [dir]` | Create the ready-made demo repo |
| `diditbreak compare [setups..]` | Compare setups: git refs, `working` (your uncommitted edits) or `none` (no context). Defaults to `HEAD` vs `working`, plus the `none` baseline |
| `diditbreak ablate [file]` | Remove one `CLAUDE.md` section, then one skill, at a time to find what helps and what hurts |
| `diditbreak report [results.json]` | Re-render a past run without re-running anything |

Exit codes: `0` no regression · `1` the last setup is clearly worse · `2` setup or configuration error.

## Writing tasks

A task is a small, real change from your backlog plus a way to tell whether it worked. Put it in `.diditbreak/tasks/*.yaml`:

```yaml
prompt: |
  Add a `slugify(text)` function to src/strings.js. It lowercases the text,
  replaces every run of non-alphanumeric characters with one hyphen, and
  strips leading and trailing hyphens. Export it.

# Must all exit 0. The agent never sees this file, so it cannot game the check.
verify: >-
  node -e "import('./src/strings.js').then(({ slugify: s }) =>
  process.exit(s('  Hello, World!  ') === 'hello-world' ? 0 : 1))"

checks:
  must_change: src/strings.js
  must_not_change: package.json
  forbid_commands: npm install
  # expect_skills: my-skill      # this task should trigger that skill
  # max_turns: 20
  # max_cost_usd: 0.50
```

## Why you can trust the numbers

- **Same code, different context.** Each trial gets its own git worktree: the code comes from the task's base commit, and only the context files differ between setups. Both states are committed, so the agent's diff holds only its own work. Your working tree is never touched.
- **Statistics that respect noise.** Agents are random, so every task runs several times. Pass rates get Wilson intervals, and comparisons use a paired bootstrap over tasks, then trials. *Better* or *worse* is only claimed when the difference survives resampling.
- **Your machine stays out of the result.** Personal settings and MCP servers are shut out (`--setting-sources project`, `--strict-mcp-config`). Skills that load from outside the repo are disclosed in the report rather than hidden.
- **Spend is bounded.** Every run has a hard budget enforced by the agent itself. Before a real experiment, diditbreak shows the plan and the worst case, then asks.

## In CI

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0                       # the base branch's context is read from git
- run: npm install -g @anthropic-ai/claude-code
- run: npx diditbreak compare origin/${{ github.base_ref }} HEAD --no-baseline --yes
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The job fails when the pull request's context is clearly worse than the base branch's. Gate it on changes to `CLAUDE.md`, `AGENTS.md` or `.claude/` so it only spends when the context actually changed.

## Configuration

`diditbreak.config.ts`:

```ts
export default {
  agent: {
    name: "claude-code",
    model: "sonnet",          // "haiku" makes experiments cheap
    maxTurns: 30,
    maxBudgetUsd: 1,          // hard cap per run
    permissionMode: "acceptEdits",
    allowedTools: ["Bash(npm test:*)"]
  },
  tasks: {
    dir: ".diditbreak/tasks",
    trials: 3,
    concurrency: 2,
    setup: ["npm ci"]         // runs in each fresh sandbox first
  }
};
```

## Agents

| Agent | Status |
|---|---|
| Claude Code | Supported: headless `stream-json`, cost, turns, tool calls, skill invocations |
| Mock | Supported: seeded and offline, models the effects above for CI and demos |
| Codex CLI, Gemini CLI | Planned, behind the same adapter interface |

## Also in the box

- **[Prompt regression suite](docs/prompt-testing.md):** the original diditbreak. It tests a single prompt with free deterministic checks first and an LLM judge only when needed (`init --prompts`, `test`).
- **[Self-hosted service](docs/service.md):** a Fastify API, BullMQ workers, Postgres, and a React dashboard, for run history and team visibility.

## Repository layout

```
packages/
  agent-eval/      sandboxes, agent adapters, checks, statistics, ablation
  cli/             the diditbreak command (one bundled file, zero dependencies)
  evaluator/       prompt suite: assertions, then LLM judge
  llm-provider/    six LLM providers with retry and pricing
  sdk/             definePrompt and the content-hashed prompt registry
  shared-types/    shared contracts
apps/              self-hosted API, worker and dashboard
examples/          context-demo, the project behind `init --demo`
```

## Development

```bash
corepack pnpm install
corepack pnpm -r build
corepack pnpm -r test     # ~390 tests; coverage thresholds enforced per package
```

CI runs the tests, integration tests against real Postgres and Redis, and a smoke test that installs the packed npm tarball in a clean directory and runs both the prompt suite and a full mock comparison, as a new user would. Nothing in CI calls a paid API.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
