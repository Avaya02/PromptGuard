import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadTasks, parseExperimentSettings } from "@diditbreak/agent-eval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_EDITED_CLAUDE_MD, DEMO_FILES } from "../demo/demo-project.js";
import { loadConfigModule } from "../config/load-config.js";
import { runCompareCommand } from "./experiment-command.js";
import { runInitCommand } from "./init-command.js";

const exec = promisify(execFile);
let cwd: string;
let originalCwd: string;
let out: string[];

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "diditbreak-init-agent-"));
  process.chdir(cwd);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => out.push(args.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("diditbreak init (agent experiments)", () => {
  it("writes a config, an example task and a self-ignoring runs directory", async () => {
    expect(await runInitCommand({})).toBe(0);

    const settings = parseExperimentSettings(await loadConfigModule(cwd, { required: true }));
    expect(settings.agent).toMatchObject({ name: "claude-code", maxBudgetUsd: 1 });
    expect(settings.trials).toBe(3);

    const [task] = await loadTasks(cwd, ".diditbreak/tasks");
    expect(task?.id).toBe("example");
    expect(task?.verify).toEqual(["npm test"]);

    expect(await readFile(join(cwd, ".diditbreak/runs/.gitignore"), "utf-8")).toBe("*\n");
  });

  it("tells you what context it found to test", async () => {
    await writeFile(join(cwd, "CLAUDE.md"), "# Rules\n");
    await runInitCommand({});
    expect(out.join("\n")).toContain("Found CLAUDE.md");
  });

  it("warns outside a git repository, since experiments need worktrees", async () => {
    await runInitCommand({});
    expect(out.join("\n")).toContain("Not a git repository");
  });

  it("does not overwrite an existing config", async () => {
    await writeFile(join(cwd, "diditbreak.config.ts"), "export default { threshold: 0.2 };\n");
    await runInitCommand({});
    expect(await readFile(join(cwd, "diditbreak.config.ts"), "utf-8")).toContain("threshold: 0.2");
    expect(out.join("\n")).toContain("already existed");
  });
});

describe("diditbreak init --demo", () => {
  it("builds a repo with the bloated CLAUDE.md as an uncommitted edit", async () => {
    expect(await runInitCommand({ demo: "demo" })).toBe(0);

    const demo = join(cwd, "demo");
    const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: demo });
    expect(stdout.trim()).toBe("M CLAUDE.md");
    expect(await readFile(join(demo, "CLAUDE.md"), "utf-8")).toBe(DEMO_EDITED_CLAUDE_MD);
  });

  it("gives a first run that shows a result for free", async () => {
    await runInitCommand({ demo: "demo" });
    process.chdir(join(cwd, "demo"));

    // The edit contradicts the project, so the comparison flags it and exits 1.
    expect(await runCompareCommand({ setups: [], agent: "mock", yes: true })).toBe(1);
  });

  it("refuses to write into a non-empty directory", async () => {
    await writeFile(join(cwd, "taken"), "x");
    await exec("mkdir", ["-p", join(cwd, "occupied")]);
    await writeFile(join(cwd, "occupied", "file"), "x");

    expect(await runInitCommand({ demo: "occupied" })).toBe(1);
    expect(out.join("\n")).toContain("not empty");
  });
});

describe("embedded demo", () => {
  // examples/context-demo is the source of truth; the CLI embeds a copy so
  // `init --demo` works from a single-file npm install.
  const source = fileURLToPath(new URL("../../../../examples/context-demo/", import.meta.url));

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "runs" && entry.name !== "node_modules") {
          files.push(...(await walk(path)));
        }
      } else if (entry.name !== "CLAUDE.bloated.md" && entry.name !== "README.md") {
        files.push(relative(source, path));
      }
    }
    return files.sort();
  }

  it("matches examples/context-demo exactly (run `node scripts/sync-demo.mjs` if this fails)", async () => {
    const files = await walk(source);
    expect(Object.keys(DEMO_FILES).sort()).toEqual(files);
    for (const path of files) {
      expect(DEMO_FILES[path], path).toBe(await readFile(join(source, path), "utf-8"));
    }
    expect(DEMO_EDITED_CLAUDE_MD).toBe(await readFile(join(source, "CLAUDE.bloated.md"), "utf-8"));
  });
});
