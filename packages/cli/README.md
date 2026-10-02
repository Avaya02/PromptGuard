# diditbreak

Regression tests for LLM prompts. Change a prompt, run one command, find out whether it still behaves.

Deterministic checks (`contains`, `regex`, JSON Schema, latency) run locally and cost nothing. An LLM judge runs only for cases that pass those checks and carry a rubric. Works offline out of the box.

```bash
npx diditbreak init
npx diditbreak test
```

```
 diditbreak 0.1.0 · mock:mock · 2 prompts · 4 cases

 sql-generator
   ✓ never-drops-tables     assert     0ms
   ✗ starts-with-select     assert     0ms
     └ regex: output did not match /^SELECT/

 support-agent
   ✓ no-canned-refusals     assert     0ms
   ✓ handles-damaged-order  judge      0ms

 ✗ sql-generator  drift 0.500 > 0.100  regressed
 ✓ support-agent  drift 0.000 ≤ 0.100

 Cases   3 passed, 1 failed · 3 zero-cost · 0 tokens · $0
 Result  FAIL 1 of 2 prompts regressed  (10ms)
```

Single file, zero dependencies, Node 20+.

## Commands

| Command | What it does |
|---|---|
| `diditbreak init` | Scaffold config, a sample prompt, and a sample suite that passes on first run |
| `diditbreak add <name> [file]` | Register a prompt, or update it if the content changed. Also takes `--content` or stdin |
| `diditbreak test` | Run the suite. `--base <ref>` compares against a git ref; `--json` for machine output |
| `diditbreak doctor` | Check config, provider keys, prompts, test files, and git setup, with the fix for each problem |

**Exit codes:** `0` pass · `1` a prompt regressed · `2` setup or configuration error. A pipeline can tell a failed check from a broken job.

## Test files

`prompt_tests/*.json`. A case needs `assert`, `expect`, or both.

```json
{
  "prompts": "sql-generator",
  "cases": [
    {
      "name": "never-drops-tables",
      "input": "Clean up inactive users",
      "assert": { "not_contains": ["DROP TABLE", "TRUNCATE"] }
    },
    {
      "name": "sql-only-output",
      "input": "List users who signed up this month",
      "assert": { "regex": "^SELECT", "max_latency_ms": 5000 },
      "expect": "A single correct PostgreSQL query with no surrounding prose."
    }
  ]
}
```

| Deterministic check | Passes when |
|---|---|
| `contains` | every listed substring is present |
| `not_contains` | no listed substring is present |
| `regex` | the pattern matches |
| `json_schema` | output parses as JSON and validates |
| `max_latency_ms` | generation finished within budget |

A failing check stops the case before any model call. `expect` is a plain-English rubric for the judge. `prompts` scopes a file (or a single case) to specific prompts; without it, cases run against every prompt.

## Providers

Set in `diditbreak.config.ts`, or pick one at `init --provider <name>`.

| `provider` | Key | |
|---|---|---|
| `mock` | none | Offline and deterministic. The default |
| `local` | none | Ollama |
| `openai` | `OPENAI_API_KEY` | `baseUrl` works for any OpenAI-compatible server |
| `anthropic` | `ANTHROPIC_API_KEY` | |
| `gemini` | `GEMINI_API_KEY` | Free tier |
| `groq` | `GROQ_API_KEY` | Free tier |

Every provider retries 429 and 5xx with backoff, uses native JSON output where available, and reports token usage and estimated cost.

## CI

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0          # baselines are read from git history
- run: npx diditbreak test --base origin/${{ github.base_ref }}
```

Commit `.diditbreak/prompts.json`. `--base` reads the previous version of each prompt from git, so an ignored registry gives the comparison nothing to compare against. `diditbreak doctor` checks for this.

## More

Source, the self-hostable API, worker, and dashboard: [github.com/Avaya02/PromptGuard](https://github.com/Avaya02/PromptGuard)

MIT
