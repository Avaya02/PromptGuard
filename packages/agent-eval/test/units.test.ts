import { describe, expect, it } from "vitest";

import { buildClaudeArgs, childEnvironment } from "../src/agents/claude-code.js";
import { parseExperimentSettings } from "../src/config.js";
import { isContextPath, listSections, removeSection } from "../src/context/context-files.js";
import { buildVariants, planAblation } from "../src/experiment/variants.js";
import { planJobs } from "../src/experiment/run-experiment.js";
import { pairedBootstrap, wilsonInterval } from "../src/stats/stats.js";
import { parseTask, TaskFileError } from "../src/tasks/load-tasks.js";
import type { AgentRunInput, AgentRunResult, AgentTask } from "../src/types.js";
import { evaluateChecks, pathMatcher } from "../src/verify/checks.js";

describe("isContextPath", () => {
  it("recognises agent context files anywhere they are loaded from", () => {
    for (const path of ["CLAUDE.md", "AGENTS.md", "packages/api/CLAUDE.md", ".claude/skills/pdf/SKILL.md", ".claude/settings.json", ".mcp.json"]) {
      expect(isContextPath(path)).toBe(true);
    }
  });

  it("leaves code and ordinary docs alone", () => {
    for (const path of ["README.md", "src/claude.ts", "docs/CLAUDE.txt", "mcp.json", "x/.claude-notes"]) {
      expect(isContextPath(path)).toBe(false);
    }
  });
});

const CLAUDE_MD = `# Project

## Testing
Run pnpm test.

\`\`\`md
## Not a heading inside a fence
\`\`\`

## Style
- Two-space indent.

### Naming
- camelCase.

## Commits
Conventional commits.
`;

describe("markdown sections", () => {
  it("lists the repeated top-level sections, ignoring fenced headings", () => {
    expect(listSections(CLAUDE_MD).map((s) => s.heading)).toEqual(["Testing", "Style", "Commits"]);
  });

  it("removes a section with its subsections and nothing else", () => {
    const { text, removed } = removeSection(CLAUDE_MD, "style");
    expect(removed).toBe(true);
    expect(text).not.toContain("Two-space");
    expect(text).not.toContain("camelCase");
    expect(text).toContain("## Testing");
    expect(text).toContain("## Commits");
    expect(text).toContain("## Not a heading inside a fence");
  });

  it("reports a heading that does not exist", () => {
    expect(removeSection(CLAUDE_MD, "Deployment").removed).toBe(false);
  });
});

describe("parseTask", () => {
  it("fills defaults and maps snake_case keys", () => {
    const task = parseTask(
      { prompt: "  Add a greet function.  ", verify: "pnpm test", checks: { forbid_commands: "npm install", max_turns: 20 } },
      ".diditbreak/tasks/add-greet.yaml"
    );

    expect(task).toMatchObject({
      id: "add-greet",
      prompt: "Add a greet function.",
      base: "HEAD",
      verify: ["pnpm test"],
      timeoutSec: 600,
      checks: { forbidCommands: ["npm install"], maxTurns: 20, mustChange: [] }
    });
  });

  it("rejects a typo'd key instead of ignoring it", () => {
    expect(() => parseTask({ prompt: "x", checks: { must_chnage: ["a"] } }, "t.yaml")).toThrow(TaskFileError);
  });

  it("rejects a task with nothing to decide pass or fail", () => {
    expect(() => parseTask({ prompt: "x" }, "t.yaml")).toThrow(/verify/);
  });

  it("names the file and field in errors", () => {
    expect(() => parseTask({ prompt: "" }, "tasks/bad.yaml")).toThrow(/tasks\/bad\.yaml: prompt/);
  });
});

function agentResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    completed: true,
    finalMessage: "",
    turns: 5,
    durationMs: 1000,
    costUsd: 0.1,
    inputTokens: 1000,
    outputTokens: 100,
    contextTokens: 18000,
    toolCalls: [],
    skillsUsed: [],
    commands: [],
    permissionDenials: 0,
    environment: { skillsLoaded: [], mcpServers: [], agents: [] },
    ...overrides
  };
}

const noChecks = { mustChange: [], mustNotChange: [], forbidCommands: [], expectSkills: [], forbidSkills: [] };

describe("pathMatcher", () => {
  it("supports exact paths, single and double stars, and directory prefixes", () => {
    expect(pathMatcher("src/a.ts")("src/a.ts")).toBe(true);
    expect(pathMatcher("src/*.ts")("src/a.ts")).toBe(true);
    expect(pathMatcher("src/*.ts")("src/deep/a.ts")).toBe(false);
    expect(pathMatcher("src/**/*.ts")("src/deep/a.ts")).toBe(true);
    expect(pathMatcher("docs/")("docs/x/y.md")).toBe(true);
    expect(pathMatcher("a.ts")("a_ts")).toBe(false);
  });
});

describe("evaluateChecks", () => {
  it("passes when every rule holds", () => {
    const outcomes = evaluateChecks(
      { ...noChecks, mustChange: ["src/*.ts"], mustNotChange: ["package.json"], forbidCommands: ["npm install"] },
      agentResult({ commands: ["pnpm test"] }),
      ["src/greet.ts"]
    );
    expect(outcomes.every((o) => o.pass)).toBe(true);
  });

  it("names the offending command for a broken rule", () => {
    const [outcome] = evaluateChecks(
      { ...noChecks, forbidCommands: ["npm install"] },
      agentResult({ commands: ["npm install lodash"] }),
      []
    );
    expect(outcome).toMatchObject({ pass: false, detail: "ran: npm install lodash" });
  });

  it("distinguishes a skill that was not loaded from one that was ignored", () => {
    const [notLoaded] = evaluateChecks({ ...noChecks, expectSkills: ["pdf"] }, agentResult(), []);
    const [ignored] = evaluateChecks(
      { ...noChecks, expectSkills: ["pdf"] },
      agentResult({ environment: { skillsLoaded: ["pdf"], mcpServers: [], agents: [] } }),
      []
    );
    expect(notLoaded?.detail).toBe("not loaded in this setup");
    expect(ignored?.detail).toBe("loaded but not invoked");
  });

  it("flags a skill used where it is forbidden", () => {
    const [outcome] = evaluateChecks({ ...noChecks, forbidSkills: ["pdf"] }, agentResult({ skillsUsed: ["pdf"] }), []);
    expect(outcome?.pass).toBe(false);
  });

  it("enforces turn and cost budgets, failing closed on unknown cost", () => {
    const outcomes = evaluateChecks(
      { ...noChecks, maxTurns: 3, maxCostUsd: 0.05 },
      agentResult({ turns: 4, costUsd: null }),
      []
    );
    expect(outcomes.map((o) => o.pass)).toEqual([false, false]);
  });
});

describe("wilsonInterval", () => {
  it("stays inside [0, 1] and is not degenerate at the extremes", () => {
    const allPass = wilsonInterval(5, 5);
    expect(allPass.high).toBe(1);
    expect(allPass.low).toBeGreaterThan(0.4);
    expect(allPass.low).toBeLessThan(1);
    expect(wilsonInterval(0, 5).low).toBe(0);
  });

  it("narrows as runs increase", () => {
    const small = wilsonInterval(6, 10);
    const large = wilsonInterval(60, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });
});

describe("pairedBootstrap", () => {
  const always = (n: number, value: boolean): boolean[] => Array.from({ length: n }, () => value);

  it("finds a clear improvement", () => {
    const tasks = Array.from({ length: 6 }, () => ({ reference: always(4, false), candidate: always(4, true) }));
    const estimate = pairedBootstrap(tasks);
    expect(estimate.mean).toBe(1);
    expect(estimate.low).toBeGreaterThan(0);
  });

  it("does not call a coin flip a difference", () => {
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      reference: [true, false, true, false],
      candidate: i % 2 === 0 ? [true, true, false, false] : [false, true, false, true]
    }));
    const estimate = pairedBootstrap(tasks);
    expect(estimate.low).toBeLessThan(0);
    expect(estimate.high).toBeGreaterThan(0);
  });

  it("is reproducible for the same input", () => {
    const tasks = [{ reference: [true, false, false], candidate: [true, true, false] }];
    expect(pairedBootstrap(tasks)).toEqual(pairedBootstrap(tasks));
  });

  it("handles no usable tasks", () => {
    expect(pairedBootstrap([{ reference: [], candidate: [true] }])).toEqual({ mean: 0, low: 0, high: 0 });
  });
});

describe("buildVariants", () => {
  it("defaults to committed versus working, with the no-context baseline first", () => {
    expect(buildVariants([], { baseline: true }).map((v) => v.name)).toEqual(["none", "HEAD", "working"]);
  });

  it("treats unknown tokens as git refs and drops duplicates", () => {
    const variants = buildVariants(["main", "main", "working"], { baseline: false });
    expect(variants.map((v) => v.name)).toEqual(["main", "working"]);
    expect(variants[0]?.context).toEqual({ kind: "ref", ref: "main" });
  });
});

describe("planAblation", () => {
  it("makes one leave-one-out variant per section and per skill", () => {
    const plan = planAblation(
      { kind: "working" },
      [
        { path: "CLAUDE.md", content: Buffer.from(CLAUDE_MD) },
        { path: ".claude/skills/pdf/SKILL.md", content: Buffer.from("---\nname: pdf\n---") },
        { path: ".claude/skills/pdf/ref.md", content: Buffer.from("x") }
      ],
      { file: "CLAUDE.md", includeSkills: true }
    );

    expect(plan.variants.map((v) => v.name)).toEqual([
      "full",
      "no-section-Testing",
      "no-section-Style",
      "no-section-Commits",
      "no-skill-pdf"
    ]);
    expect(plan.removed["no-skill-pdf"]).toBe("skill pdf");
    expect(plan.variants[4]?.remove).toEqual([".claude/skills/pdf"]);
  });
});

describe("planJobs", () => {
  it("orders trial-major so a partial run stays balanced", () => {
    const task = (id: string) => ({ id }) as AgentTask;
    const jobs = planJobs([task("a"), task("b")], buildVariants(["x", "y"], { baseline: false }), 2);
    expect(jobs.map((j) => `${j.trial}${j.task.id}${j.variant.name}`)).toEqual([
      "1ax", "1ay", "1bx", "1by", "2ax", "2ay", "2bx", "2by"
    ]);
  });
});

describe("buildClaudeArgs", () => {
  const input = {
    prompt: "Fix the bug",
    config: {
      name: "claude-code",
      model: "sonnet",
      maxTurns: 20,
      maxBudgetUsd: 0.5,
      permissionMode: "acceptEdits",
      allowedTools: ["Bash(pnpm test:*)"],
      isolateMcp: true
    }
  } as AgentRunInput;

  it("runs headless, reproducibly, and within budget", () => {
    const args = buildClaudeArgs(input);
    expect(args.slice(0, 2)).toEqual(["-p", "Fix the bug"]);
    expect(args).toEqual(expect.arrayContaining(["stream-json", "--no-session-persistence", "--max-budget-usd", "0.5"]));
    expect(args.join(" ")).toContain("--setting-sources project");
    expect(args.join(" ")).toContain("--model sonnet");
  });

  it("shuts out personal MCP servers when isolating", () => {
    const args = buildClaudeArgs(input);
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
  });

  it("omits optional flags when unset", () => {
    const args = buildClaudeArgs({ ...input, config: { ...input.config, isolateMcp: false, allowedTools: [], model: undefined } });
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--model");
  });
});

describe("childEnvironment", () => {
  it("strips the variables that make Claude Code refuse to nest", () => {
    const env = childEnvironment({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("parseExperimentSettings", () => {
  it("uses safe defaults with no config", () => {
    const settings = parseExperimentSettings(undefined);
    expect(settings.agent).toMatchObject({ name: "claude-code", maxBudgetUsd: 1, isolateMcp: true });
    expect(settings).toMatchObject({ tasksDir: ".diditbreak/tasks", trials: 3, concurrency: 2 });
  });

  it("reads the agent and tasks sections alongside prompt-testing keys", () => {
    const settings = parseExperimentSettings({
      threshold: 0.1,
      agent: { name: "mock", model: "haiku" },
      tasks: { trials: 5, setup: ["pnpm install"] }
    });
    expect(settings.agent.model).toBe("haiku");
    expect(settings.trials).toBe(5);
    expect(settings.setup).toEqual(["pnpm install"]);
  });

  it("rejects unknown agent settings", () => {
    expect(() => parseExperimentSettings({ agent: { maxTurn: 5 } })).toThrow();
  });
});

describe("MockAgentAdapter commands", () => {
  it("runs a `when` command only if the context contains the trigger", async () => {
    const { MockAgentAdapter } = await import("../src/agents/mock.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "diditbreak-mock-"));

    const script = {
      files: {},
      requires: [],
      breaksOn: [],
      flaky: 0,
      commands: [
        { run: "npm install jest", when: "Jest" },
        { run: "pnpm add x", unless: "no dependencies" }
      ],
      skills: []
    };

    const run = (text: string) =>
      new MockAgentAdapter().run({
        cwd: dir,
        prompt: "p",
        config: { name: "mock", maxTurns: 1, maxBudgetUsd: 1, permissionMode: "acceptEdits", allowedTools: [], isolateMcp: true },
        timeoutMs: 1000,
        transcriptPath: join(dir, "t.jsonl"),
        trial: 1,
        context: { paths: ["CLAUDE.md"], text },
        mock: script
      });

    try {
      expect((await run("Use Jest.")).commands).toEqual(["npm install jest", "pnpm add x"]);
      expect((await run("no dependencies")).commands).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
