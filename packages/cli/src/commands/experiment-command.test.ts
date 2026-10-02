import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import chalk from "chalk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAblateCommand, runCompareCommand } from "./experiment-command.js";

const exec = promisify(execFile);

let repo: string;
let originalCwd: string;
let out: string[];
let err: string[];
let originalLevel: typeof chalk.level;

const CLAUDE_MD = "# Demo\n\n## Commands\nRun tests with `node --test`. No dependencies.\n\n## Style\nTwo-space indent.\n";
const BAD_SECTION = "\n## Wiki\nAll tests must use Jest.\n";

function taskYaml(file: string): string {
  return `prompt: Create ${file}.
verify: test -f ${file}
checks:
  must_change: ${file}
  forbid_commands: npm install
mock:
  files: { "${file}": "export {};\\n" }
  requires: node --test
  breaks_on: Jest
  commands:
    - run: npm install --save-dev jest
      when: Jest
`;
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "diditbreak-cli-exp-"));
  await mkdir(join(repo, ".diditbreak/tasks"), { recursive: true });
  await writeFile(join(repo, "CLAUDE.md"), CLAUDE_MD);
  await writeFile(join(repo, ".diditbreak/tasks/a.yaml"), taskYaml("a.js"));
  await writeFile(join(repo, ".diditbreak/tasks/b.yaml"), taskYaml("b.js"));
  await writeFile(join(repo, "diditbreak.config.ts"), "export default { agent: { name: 'mock' }, tasks: { trials: 2 } };\n");
  const git = (...args: string[]) => exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "init");
  await writeFile(join(repo, "CLAUDE.md"), CLAUDE_MD + BAD_SECTION);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

beforeEach(() => {
  originalCwd = process.cwd();
  process.chdir(repo);
  out = [];
  err = [];
  originalLevel = chalk.level;
  chalk.level = 0;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => err.push(args.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  chalk.level = originalLevel;
  vi.restoreAllMocks();
});

describe("diditbreak compare", () => {
  it("reports the working-tree edit as worse and exits 1 to fail CI", async () => {
    expect(await runCompareCommand({ setups: [], yes: true })).toBe(1);

    const report = out.join("\n");
    expect(report).toMatch(/none\s+0\/4/);
    expect(report).toMatch(/HEAD\s+4\/4\s+100%/);
    expect(report).toMatch(/working\s+0\/4/);
    expect(report).toMatch(/working\s+−100 pts.*worse/);
    expect(report).toMatch(/forbid_command npm install\s+none 0\/4\s+HEAD 0\/4\s+working 4\/4/);
    expect(report).toContain("simulated");
  });

  it("exits 0 when the change is not worse", async () => {
    // HEAD against itself: identical context, identical results.
    expect(await runCompareCommand({ setups: ["HEAD", "HEAD~0"], baseline: false, yes: true })).toBe(0);
  });

  it("prints a machine-readable summary with --json", async () => {
    expect(await runCompareCommand({ setups: ["HEAD", "working"], baseline: false, json: true, yes: true })).toBe(1);

    const report = JSON.parse(out.join(""));
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.reference).toBe("HEAD");
    expect(report.summary.comparisons[0]).toMatchObject({ variant: "working", verdict: "worse" });
    expect(await readFile(join(repo, report.resultsPath), "utf-8")).toContain('"schemaVersion": 1');
  });

  it("keeps run artifacts out of git without touching .gitignore", async () => {
    await runCompareCommand({ setups: ["HEAD"], baseline: false, yes: true });
    expect(await readFile(join(repo, ".diditbreak/runs/.gitignore"), "utf-8")).toBe("*\n");
    const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: repo });
    expect(stdout).not.toContain(".diditbreak/runs");
  });

  it("rejects an unknown git ref before spending anything", async () => {
    expect(await runCompareCommand({ setups: ["no-such-branch"], yes: true })).toBe(2);
    expect(err.join("\n")).toMatch(/Unknown git ref "no-such-branch"/);
  });

  it("explains a missing task directory", async () => {
    expect(await runCompareCommand({ setups: [], tasks: "nope", yes: true })).toBe(2);
    expect(err.join("\n")).toMatch(/task directory not found/);
  });

  it("refuses to run outside a git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "diditbreak-nogit-"));
    process.chdir(outside);
    try {
      expect(await runCompareCommand({ setups: [], yes: true })).toBe(2);
      expect(err.join("\n")).toMatch(/Not inside a git repository/);
    } finally {
      process.chdir(repo);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("asks for confirmation before real agent runs when not interactive", async () => {
    expect(await runCompareCommand({ setups: [], agent: "claude-code" })).toBe(2);
    expect(err.join("\n")).toMatch(/--yes/);
  });
});

describe("diditbreak ablate", () => {
  it("names the section whose removal fixes the agent", async () => {
    expect(await runAblateCommand({ yes: true })).toBe(0);

    const report = out.join("\n");
    expect(report).toMatch(/no-section-Wiki\s+\+100 pts.*better/);
    expect(report).toContain("removes CLAUDE.md › Wiki");
    expect(report).toMatch(/no-section-Style\s+±0 pts.*no clear difference/);
  });

  it("explains when there is nothing to remove", async () => {
    expect(await runAblateCommand({ file: "MISSING.md", skills: false, yes: true })).toBe(2);
    expect(err.join("\n")).toMatch(/Nothing to remove/);
  });
});
