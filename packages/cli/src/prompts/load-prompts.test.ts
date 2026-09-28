import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PromptGuardCliError } from "../errors.js";
import { resolveCommitSha } from "../git/resolve-commit-sha.js";
import { loadBaselinePrompts } from "./load-baseline-prompts.js";
import { loadCurrentPrompts } from "./load-current-prompts.js";

const run = promisify(execFile);
let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "promptguard-prompts-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function registry(prompts: Array<{ name: string; content: string }>): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    prompts: prompts.map((p) => ({
      ...p,
      hash: "a".repeat(64),
      version: 1,
      createdAt: now,
      updatedAt: now
    }))
  });
}

async function writeRegistry(prompts: Array<{ name: string; content: string }>): Promise<void> {
  await mkdir(join(cwd, ".promptguard"), { recursive: true });
  await writeFile(join(cwd, ".promptguard", "prompts.json"), registry(prompts), "utf-8");
}

describe("loadCurrentPrompts", () => {
  it("reads the registry", async () => {
    await writeRegistry([{ name: "greeter", content: "Say hello." }]);

    const prompts = await loadCurrentPrompts(cwd);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.name).toBe("greeter");
  });

  it("raises an actionable error when the registry is absent", async () => {
    await expect(loadCurrentPrompts(cwd)).rejects.toThrow(/No prompts registered/);
  });

  it("raises an actionable error when the registry is empty", async () => {
    await writeRegistry([]);

    const error = await loadCurrentPrompts(cwd).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PromptGuardCliError);
    expect((error as PromptGuardCliError).hint).toContain("promptguard add");
  });
});

describe("loadBaselinePrompts", () => {
  it("returns an empty map outside a git repository", async () => {
    expect((await loadBaselinePrompts(cwd, "HEAD")).size).toBe(0);
  });

  it("reads a committed registry from git history", async () => {
    await run("git", ["init", "-q"], { cwd });
    await run("git", ["config", "user.email", "test@example.com"], { cwd });
    await run("git", ["config", "user.name", "Test"], { cwd });

    await writeRegistry([{ name: "greeter", content: "Original text." }]);
    await run("git", ["add", "-A"], { cwd });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd });

    const baseline = await loadBaselinePrompts(cwd, "HEAD");

    // This is the path that silently broke while .promptguard was gitignored.
    expect(baseline.get("greeter")).toBe("Original text.");
  });

  it("returns an empty map for an unknown ref", async () => {
    await run("git", ["init", "-q"], { cwd });
    expect((await loadBaselinePrompts(cwd, "no-such-ref")).size).toBe(0);
  });
});

describe("resolveCommitSha", () => {
  it("returns the HEAD sha inside a repository", async () => {
    await run("git", ["init", "-q"], { cwd });
    await run("git", ["config", "user.email", "test@example.com"], { cwd });
    await run("git", ["config", "user.name", "Test"], { cwd });
    await writeFile(join(cwd, "file.txt"), "content", "utf-8");
    await run("git", ["add", "-A"], { cwd });
    await run("git", ["commit", "-q", "-m", "initial"], { cwd });

    expect(await resolveCommitSha(cwd)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('falls back to "unknown" outside a repository', async () => {
    expect(await resolveCommitSha(cwd)).toBe("unknown");
  });
});
