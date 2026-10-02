# diditbreak

**Did your CLAUDE.md change make your coding agent better or worse?**

diditbreak runs your real tasks in fresh git sandboxes under each context setup (`CLAUDE.md`, `AGENTS.md`, skills, MCP config), several times each, and measures three things:
- **success:** your own checks pass
- **overwhelm:** cost, turns, and starting-context tokens
- **confusion:** broken rules, skills missed, actions blocked

```bash
npx diditbreak init --demo && cd diditbreak-demo
npx diditbreak compare --agent mock   # free and offline
npx diditbreak compare                # real Claude Code runs; asks before spending
```

```
 setup    solved         cost/run  turns  context  time/run
 none       4/4  100%    $0.025    3.0    18.3k    9s
 HEAD       4/4  100%    $0.049    9.0    18.5k    22s
 working    3/4   75%    $0.067    11.0   18.9k    38s

 vs HEAD
   working  −25 pts   (95% CI −75 … ±0 pts)        no clear difference
            cost +36% · turns +22% · starting context +450 tokens

 Rules broken
   forbid_command npm install  none 0/4   HEAD 0/4   working 1/4
                               e.g. ran: npm install --save-dev jest
```

That block is real Claude Code output. Pasting 41 lines of team-wiki guidelines into a correct `CLAUDE.md` made the agent try to install Jest against the project's rules, at 36% more cost per task.

## Commands

| Command | |
|---|---|
| `diditbreak init` | Set up experiments in this repo |
| `diditbreak init --demo [dir]` | Create a ready-made demo repo |
| `diditbreak compare [setups..]` | Compare git refs, `working` (uncommitted edits) and `none` (no context) |
| `diditbreak ablate [file]` | Remove one section or skill at a time to find what helps and what hurts |
| `diditbreak report [results.json]` | Re-render a past run |
| `diditbreak init --prompts`, `test` | The prompt regression suite |

Exit codes: `0` no regression · `1` the last setup is clearly worse · `2` setup error.

Verdicts use a paired bootstrap, so *better* or *worse* is only claimed when the difference survives resampling. Each run has a hard budget cap enforced by the agent, and you see the worst case before anything runs.

One file, zero dependencies, Node 20+. Supports Claude Code today, plus a free mock agent for CI.

Docs and source: [github.com/Avaya02/PromptGuard](https://github.com/Avaya02/PromptGuard)

MIT
