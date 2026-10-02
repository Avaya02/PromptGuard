# Prompt regression suite

The original diditbreak mode: regression tests for a single prompt. Set it up with `diditbreak init --prompts`, run it with `diditbreak test`.

## Why

Prompts are code you can't diff meaningfully. Changing `"Be concise"` to `"Be concise and empathetic"` changes every downstream output, and a string comparison can't tell you whether the change improved things or broke them.

The usual answers both fail. **Exact-match assertions** break on harmless rewording, so teams delete them. **LLM-judging everything** is slow and costs money on every commit, so teams run it rarely.

diditbreak splits the work. Deterministic checks (`contains`, `regex`, JSON Schema, latency budgets) run locally for free and catch most real breakage: malformed JSON, apology preambles, destructive SQL, blown latency. **A failing check stops the case before any model is called.** Only cases that pass and carry a rubric reach the LLM judge.

So the whole suite can run on every commit, and tokens get spent only where semantic judgement is actually needed.

## The CLI

| Command | |
|---|---|
| `diditbreak init --prompts [--provider <name>]` | Scaffold a working project: config, a sample prompt, a passing suite |
| `diditbreak add <name> [file]` | Register a prompt, or update it if its content changed (`--content` and stdin work too) |
| `diditbreak test [--base <ref>] [--json]` | Run the suite; compare against a git ref; machine-readable output for CI |
| `diditbreak doctor` | Check config, provider keys, prompts, test files and git setup, and print the fix for anything wrong |

A few details that matter in daily use:

- **Exit codes mean something.** `0` pass, `1` a prompt regressed, `2` the tool couldn't run. CI can tell a failed check from a broken job.
- **Every error says what to do next.** No raw `ENOENT`s. A missing config points at `init --prompts`, an empty registry at `add`, a missing key names the environment variable.
- **`doctor` catches the silent failures.** A gitignored prompt registry makes `--base` quietly compare against nothing. `doctor` flags that, along with test files that target prompts that don't exist.
- **Quiet in CI, live in a terminal.** The spinner only runs in an interactive TTY; `--json` output is stable and versioned (`schemaVersion: 1`).

## Test files

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

| Check | Passes when | Cost |
|---|---|---|
| `contains` / `not_contains` | substrings present / absent | free, local |
| `regex` | the pattern matches | free, local |
| `json_schema` | output parses and validates | free, local |
| `max_latency_ms` | generation finished within budget | free, local |
| `expect` | the LLM judge says the rubric is met | one judge call |

`prompts` scopes a file, or a single case, to specific prompts. Without it, cases run against every prompt. Unknown keys are rejected, so a typo fails loudly instead of passing silently.

## Providers

| `provider` | Key | Notes |
|---|---|---|
| `mock` | none | Offline, deterministic. **Default** |
| `local` | none | Ollama |
| `openai` | `OPENAI_API_KEY` | With `baseUrl`, any OpenAI-compatible server (vLLM, llama.cpp, LM Studio), key optional |
| `anthropic` | `ANTHROPIC_API_KEY` | |
| `gemini` | `GEMINI_API_KEY` | Free tier; native JSON mode |
| `groq` | `GROQ_API_KEY` | Free tier |

All providers retry 429 and 5xx with exponential backoff and jitter, use structured JSON output where the API supports it, and report tokens and estimated cost.

## In CI

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0                       # baselines are read from git history
- run: npx diditbreak test --base origin/${{ github.base_ref }}
```

Commit `.diditbreak/prompts.json`. `--base` reads each prompt's previous version with `git show`, so an ignored registry leaves nothing to compare against.

