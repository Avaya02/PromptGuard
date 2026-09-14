import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadTestCases } from "../tests/load-test-cases.js";
import { runInitCommand } from "./init-command.js";

let cwd: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "promptguard-init-"));
  process.chdir(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runInitCommand", () => {
  it("scaffolds config, sample tests, and an empty registry", async () => {
    expect(await runInitCommand({})).toBe(0);

    const config = await readFile(join(cwd, "promptguard.config.ts"), "utf-8");
    expect(config).toContain('provider: "mock"');
    expect(config).toContain("threshold");

    const registry = JSON.parse(await readFile(join(cwd, ".promptguard/prompts.json"), "utf-8"));
    expect(registry).toEqual({ prompts: [] });

    await readFile(join(cwd, "prompt_tests/sample.json"), "utf-8");
  });

  it("generates sample tests the loader accepts", async () => {
    await runInitCommand({});

    // The scaffold must be immediately runnable, not just syntactically present.
    const cases = await loadTestCases(cwd, "prompt_tests");
    expect(cases).toHaveLength(2);

    const deterministic = cases.find((c) => c.assert !== undefined);
    const semantic = cases.find((c) => c.expect !== null);
    expect(deterministic).toBeDefined();
    expect(semantic).toBeDefined();
  });

  it("defaults to mock so no API key is needed", async () => {
    await runInitCommand({});
    const config = await readFile(join(cwd, "promptguard.config.ts"), "utf-8");
    expect(config).not.toContain("API_KEY");
  });

  it("writes the requested provider", async () => {
    await runInitCommand({ provider: "groq" });
    const config = await readFile(join(cwd, "promptguard.config.ts"), "utf-8");

    expect(config).toContain('provider: "groq"');
    expect(config).toContain("llama3-8b-8192");
  });

  it("rejects an unknown provider without writing anything", async () => {
    expect(await runInitCommand({ provider: "nonsense" })).toBe(1);
    await expect(readFile(join(cwd, "promptguard.config.ts"), "utf-8")).rejects.toThrow();
  });

  it("does not clobber existing files by default", async () => {
    await writeFile(join(cwd, "promptguard.config.ts"), "// mine", "utf-8");

    expect(await runInitCommand({})).toBe(0);
    expect(await readFile(join(cwd, "promptguard.config.ts"), "utf-8")).toBe("// mine");
  });

  it("overwrites when force is set", async () => {
    await writeFile(join(cwd, "promptguard.config.ts"), "// mine", "utf-8");

    await runInitCommand({ force: true });
    expect(await readFile(join(cwd, "promptguard.config.ts"), "utf-8")).toContain("threshold");
  });

  it("leaves .gitignore alone so the registry stays committed", async () => {
    await writeFile(join(cwd, ".gitignore"), "node_modules\n", "utf-8");

    await runInitCommand({});

    // Ignoring .promptguard would silently break `--base` diffing, which reads
    // the registry out of git history.
    const gitignore = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(gitignore).not.toContain(".promptguard");
  });

  it("is safe to run twice", async () => {
    expect(await runInitCommand({})).toBe(0);
    expect(await runInitCommand({})).toBe(0);
  });

  it("creates prompt_tests even when the directory already exists", async () => {
    await mkdir(join(cwd, "prompt_tests"), { recursive: true });
    expect(await runInitCommand({})).toBe(0);
    await readFile(join(cwd, "prompt_tests/sample.json"), "utf-8");
  });
});
