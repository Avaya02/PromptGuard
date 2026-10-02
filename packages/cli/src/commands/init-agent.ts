import { execFile } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import chalk from "chalk";

import { DEMO_EDITED_CLAUDE_MD, DEMO_FILES } from "../demo/demo-project.js";

const exec = promisify(execFile);

const AGENT_CONFIG = `// diditbreak: does a change to CLAUDE.md, AGENTS.md or your skills make your
// coding agent better or worse? Each setup runs the same tasks in fresh
// sandboxes; results are measured, not guessed.
export default {
  agent: {
    name: "claude-code",
    // Unset uses Claude Code's default. "haiku" makes experiments cheap.
    model: "sonnet",
    maxTurns: 30,
    // Hard spend cap per run, enforced by Claude Code itself.
    maxBudgetUsd: 1,
    permissionMode: "acceptEdits",
    // Commands the agent may run without asking, e.g. your test runner.
    // Anything else is refused and reported as a blocked action.
    allowedTools: ["Bash(npm test:*)"]
  },
  tasks: {
    dir: ".diditbreak/tasks",
    // Agents are non-deterministic: one run proves nothing. 3 is the minimum.
    trials: 3,
    concurrency: 2,
    // Runs in each fresh sandbox before the agent starts, e.g. "npm ci".
    setup: []
  }
};
`;

const EXAMPLE_TASK = `# A task for your coding agent. diditbreak runs it in a fresh sandbox under
# each context setup, then decides pass or fail with \`verify\` and \`checks\`.
#
# Make it real: a small change from your backlog that an agent can finish in a
# few minutes, with a command that proves it worked.
prompt: |
  Add a --version flag to the CLI that prints the version from package.json.

# Commands that must all exit 0 after the agent finishes. Prefer checks the
# agent cannot see or edit (it never sees this file), so it cannot game them.
verify:
  - npm test

# Behaviour rules, checked against what the agent actually did.
checks:
  must_not_change: package-lock.json
  forbid_commands: [git push, npm publish]
  # expect_skills: my-skill      # a skill this task should trigger
  # max_turns: 20
  # max_cost_usd: 0.50
`;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

async function write(path: string, contents: string, force: boolean): Promise<"created" | "exists"> {
  if (!force && (await exists(path))) {
    return "exists";
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return "created";
}

/** What the repository already gives the agent: the thing experiments will test. */
async function describeContext(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of ["CLAUDE.md", "AGENTS.md", ".mcp.json"]) {
    if (await exists(join(cwd, file))) {
      found.push(file);
    }
  }
  const skills = await readdir(join(cwd, ".claude/skills")).catch(() => [] as string[]);
  if (skills.length > 0) {
    found.push(`${skills.length} skill${skills.length === 1 ? "" : "s"}`);
  }
  return found;
}

export async function runAgentInit(force: boolean): Promise<number> {
  const cwd = process.cwd();
  const results: Array<[string, "created" | "exists"]> = [
    ["diditbreak.config.ts", await write(join(cwd, "diditbreak.config.ts"), AGENT_CONFIG, force)],
    [".diditbreak/tasks/example.yaml", await write(join(cwd, ".diditbreak/tasks/example.yaml"), EXAMPLE_TASK, force)],
    [".diditbreak/runs/.gitignore", await write(join(cwd, ".diditbreak/runs/.gitignore"), "*\n", force)]
  ];

  console.log("");
  for (const [file, state] of results) {
    console.log(`  ${state === "created" ? chalk.green("created") : chalk.yellow("exists ")}  ${file}`);
  }

  const context = await describeContext(cwd);
  const inRepo = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd }).then(
    () => true,
    () => false
  );

  console.log("");
  console.log(chalk.bold("diditbreak initialised."));
  console.log(
    chalk.dim(
      context.length > 0
        ? `  Found ${context.join(", ")}: that is what compare and ablate will test.`
        : "  No CLAUDE.md, AGENTS.md or skills found yet; compare will measure the agent with no context."
    )
  );
  if (!inRepo) {
    console.log(chalk.yellow("  Not a git repository: experiments sandbox your code with git worktrees. Run `git init` first."));
  }
  if (results[0]![1] === "exists") {
    console.log(chalk.dim("  diditbreak.config.ts already existed; add an `agent` and `tasks` section to it if needed."));
  }

  console.log("");
  console.log("Next:");
  console.log(`  1. Turn ${chalk.cyan(".diditbreak/tasks/example.yaml")} into a real task from your backlog`);
  console.log(`  2. ${chalk.cyan("diditbreak compare")}            committed context vs your uncommitted edits`);
  console.log(`  3. ${chalk.cyan("diditbreak ablate")}             which part of CLAUDE.md helps, and which hurts`);
  console.log("");
  console.log(chalk.dim(`  New to this? ${chalk.cyan("diditbreak init --demo")} builds a ready-made example to try first.`));
  console.log("");
  return 0;
}

export async function runDemoInit(directory: string): Promise<number> {
  const target = resolve(process.cwd(), directory);

  if (await exists(target)) {
    const entries = await readdir(target).catch(() => [] as string[]);
    if (entries.length > 0) {
      console.error(`${chalk.red("✗")} ${relative(process.cwd(), target) || target} already exists and is not empty.`);
      console.error("  Pass another directory: diditbreak init --demo my-demo");
      return 1;
    }
  }

  for (const [path, contents] of Object.entries(DEMO_FILES)) {
    const file = join(target, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  const git = (...args: string[]) =>
    exec("git", ["-c", "user.name=diditbreak demo", "-c", "user.email=demo@example.com", ...args], { cwd: target });

  try {
    await git("init", "-q");
    await git("add", "-A");
    await git("commit", "-qm", "context-demo: a short, correct CLAUDE.md");
  } catch (error) {
    console.error(`${chalk.red("✗")} git failed: ${(error as Error).message}`);
    return 1;
  }

  // The change under test sits on top as an uncommitted edit, which is
  // exactly what `diditbreak compare` measures by default.
  await writeFile(join(target, "CLAUDE.md"), DEMO_EDITED_CLAUDE_MD);

  const shown = relative(process.cwd(), target) || ".";
  console.log("");
  console.log(chalk.bold("Demo ready."), chalk.dim(`(${shown})`));
  console.log("");
  console.log("  A tiny Node project. Its committed CLAUDE.md is short and correct; the uncommitted");
  console.log("  edit pastes 41 lines of generic team-wiki guidelines on top, including a Jest rule");
  console.log("  that contradicts the project. Did the edit make the agent better or worse?");
  console.log("");
  console.log(`  ${chalk.cyan(`cd ${shown}`)}`);
  console.log(`  ${chalk.cyan("diditbreak compare --agent mock")}   free and offline; numbers are simulated`);
  console.log(`  ${chalk.cyan("diditbreak compare")}                real Claude Code runs (~$0.60 with haiku; asks first)`);
  console.log(`  ${chalk.cyan("diditbreak ablate")}                 which section of CLAUDE.md is to blame`);
  console.log("");
  return 0;
}
