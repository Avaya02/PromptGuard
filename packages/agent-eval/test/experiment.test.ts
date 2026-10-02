import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config.js";
import { MockAgentAdapter } from "../src/agents/mock.js";
import { readContextFiles } from "../src/context/context-files.js";
import { runExperiment } from "../src/experiment/run-experiment.js";
import { buildVariants, planAblation } from "../src/experiment/variants.js";
import { summarizeExperiment } from "../src/stats/summarize.js";
import { parseTask } from "../src/tasks/load-tasks.js";
import type { AgentTask, ExperimentResult } from "../src/types.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });

let repo: string;
let runs: string;

const COMMITTED_CLAUDE_MD = `# Project

## Tooling
This project uses pnpm.

## Style
Two-space indent.
`;

// The working-tree edit adds a section that contradicts the tooling rule.
const EDITED_CLAUDE_MD = `${COMMITTED_CLAUDE_MD}
## Legacy
Use npm and yarn interchangeably.
`;

function task(id: string, file: string): AgentTask {
  return parseTask(
    {
      prompt: `Create ${file}.`,
      verify: [`test -f ${file}`],
      checks: { must_change: [file], forbid_commands: ["npm install"], expect_skills: ["greeter"] },
      mock: {
        files: { [file]: "export {};\n" },
        requires: ["pnpm"],
        breaks_on: ["interchangeably"],
        commands: [{ run: "npm install", unless: "pnpm" }],
        skills: ["greeter"]
      }
    },
    `${id}.yaml`
  );
}

const tasks = [task("add-greet", "src/greet.ts"), task("add-farewell", "src/farewell.ts")];

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "diditbreak-repo-"));
  runs = await mkdtemp(join(tmpdir(), "diditbreak-runs-"));

  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, ".claude/skills/greeter"), { recursive: true });
  await writeFile(join(repo, "src/.gitkeep"), "");
  await writeFile(join(repo, "CLAUDE.md"), COMMITTED_CLAUDE_MD);
  await writeFile(join(repo, ".claude/skills/greeter/SKILL.md"), "---\nname: greeter\n---\nGreet people.\n");

  await git(repo, "init", "-q");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-qm", "init");

  await writeFile(join(repo, "CLAUDE.md"), EDITED_CLAUDE_MD);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(runs, { recursive: true, force: true });
});

async function experiment(variants: ReturnType<typeof buildVariants>, runId: string): Promise<ExperimentResult> {
  return runExperiment({
    repoRoot: repo,
    runDir: join(runs, runId),
    runId,
    tasks,
    variants,
    agent: new MockAgentAdapter(),
    config: { ...DEFAULT_SETTINGS.agent, name: "mock" },
    trials: 3,
    concurrency: 3,
    setup: []
  });
}

describe("runExperiment end to end", () => {
  let result: ExperimentResult;

  beforeAll(async () => {
    result = await experiment(buildVariants(["HEAD", "working"], { baseline: true }), "compare");
  });

  it("runs every task × setup × trial", () => {
    expect(result.results).toHaveLength(2 * 3 * 3);
  });

  it("passes with the committed context", () => {
    const head = result.results.filter((r) => r.variant === "HEAD");
    expect(head.every((r) => r.passed)).toBe(true);
  });

  it("fails when the edit adds a contradicting instruction", () => {
    const working = result.results.filter((r) => r.variant === "working");
    expect(working.every((r) => !r.passed && r.failure === "verify-failed")).toBe(true);
  });

  it("fails without context, breaking the npm rule and missing the skill", () => {
    const none = result.results.filter((r) => r.variant === "none");
    expect(none.every((r) => !r.passed)).toBe(true);
    const checks = none[0]!.checks;
    expect(checks.find((c) => c.check === "forbid_command npm install")).toMatchObject({ pass: false });
    expect(checks.find((c) => c.check === "expect_skill greeter")).toMatchObject({
      pass: false,
      detail: "not loaded in this setup"
    });
  });

  it("records only the agent's own changes in the diff, not the context swap", async () => {
    const head = result.results.find((r) => r.variant === "HEAD")!;
    expect(head.changedFiles).toEqual([head.taskId === "add-greet" ? "src/greet.ts" : "src/farewell.ts"]);
    const patch = await readFile(join(runs, "compare", head.diffPath), "utf-8");
    expect(patch).not.toContain("CLAUDE.md");
  });

  it("measures heavier starting context for heavier CLAUDE.md files", () => {
    const context = (variant: string) =>
      result.results.find((r) => r.variant === variant)!.agent.contextTokens!;
    expect(context("none")).toBeLessThan(context("HEAD"));
    expect(context("HEAD")).toBeLessThan(context("working"));
  });

  it("summarises with an honest verdict against the committed setup", () => {
    const summary = summarizeExperiment(result);
    expect(summary.reference).toBe("HEAD");

    const working = summary.comparisons.find((c) => c.variant === "working")!;
    expect(working.verdict).toBe("worse");
    expect(working.passRate.mean).toBe(-1);
    expect(working.contextTokensChange).toBeGreaterThan(0);

    const head = summary.variants.find((v) => v.name === "HEAD")!;
    expect(head.passed).toBe(6);
    expect(head.skillsUsed).toEqual({ greeter: 6 });
  });

  it("writes results.json and per-trial artifacts", async () => {
    const saved = JSON.parse(await readFile(join(runs, "compare", "results.json"), "utf-8")) as ExperimentResult;
    expect(saved.results).toHaveLength(18);
    expect(await readdir(join(runs, "compare", "working", "add-greet", "1"))).toEqual(
      expect.arrayContaining(["changes.patch", "result.json", "transcript.jsonl"])
    );
  });

  it("leaves no worktrees or sandboxes behind", async () => {
    const { stdout } = await git(repo, "worktree", "list");
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });

  it("does not touch the user's working tree", async () => {
    expect(await readFile(join(repo, "CLAUDE.md"), "utf-8")).toBe(EDITED_CLAUDE_MD);
    const { stdout } = await git(repo, "status", "--porcelain");
    expect(stdout.trim()).toBe("M CLAUDE.md");
  });
});

describe("ablation end to end", () => {
  it("pins the regression on the one section that causes it", async () => {
    const files = await readContextFiles(repo, { kind: "working" });
    const plan = planAblation({ kind: "working" }, files, { file: "CLAUDE.md", includeSkills: true });

    expect(plan.variants.map((v) => v.name)).toEqual([
      "full",
      "no-section-Tooling",
      "no-section-Style",
      "no-section-Legacy",
      "no-skill-greeter"
    ]);

    const result = await experiment(plan.variants, "ablate");
    const summary = summarizeExperiment(result, "full");
    const verdict = (name: string) => summary.comparisons.find((c) => c.variant === name)!.verdict;

    // Only removing the contradicting section makes the agent succeed.
    expect(verdict("no-section-Legacy")).toBe("better");
    expect(verdict("no-section-Style")).toBe("no-clear-difference");
    expect(verdict("no-section-Tooling")).toBe("no-clear-difference");
  });
});
