import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAddCommand } from "./add-command.js";

let cwd: string;
let originalCwd: string;
let out: string[];

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "promptguard-add-"));
  process.chdir(cwd);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => out.push(args.join(" ")));
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function registry(): Promise<Array<{ name: string; content: string; version: number }>> {
  return JSON.parse(await readFile(join(cwd, ".promptguard/prompts.json"), "utf-8")).prompts;
}

describe("runAddCommand", () => {
  it("registers a prompt from a file", async () => {
    await writeFile(join(cwd, "p.md"), "You are helpful.\n", "utf-8");

    expect(await runAddCommand({ name: "helper", file: "p.md" })).toBe(0);

    const [prompt] = await registry();
    expect(prompt).toMatchObject({ name: "helper", content: "You are helpful.", version: 1 });
    expect(out.join("\n")).toContain("registered");
  });

  it("registers a prompt from inline content", async () => {
    expect(await runAddCommand({ name: "inline", content: "Be brief." })).toBe(0);
    expect((await registry())[0]?.content).toBe("Be brief.");
  });

  it("reports unchanged content without bumping the version", async () => {
    await runAddCommand({ name: "p", content: "same" });
    expect(await runAddCommand({ name: "p", content: "same" })).toBe(0);

    expect((await registry())[0]?.version).toBe(1);
    expect(out.join("\n")).toContain("unchanged");
  });

  it("ignores trailing whitespace differences", async () => {
    // Editors add trailing newlines; that must not count as a new version.
    await runAddCommand({ name: "p", content: "text" });
    await runAddCommand({ name: "p", content: "text\n\n  " });

    expect((await registry())[0]?.version).toBe(1);
  });

  it("bumps the version when content changes", async () => {
    await runAddCommand({ name: "p", content: "v1" });
    await runAddCommand({ name: "p", content: "v2" });

    expect((await registry())[0]?.version).toBe(2);
    expect(out.join("\n")).toContain("v1 → v2");
  });

  it("fails with a hint when the file does not exist", async () => {
    expect(await runAddCommand({ name: "p", file: "missing.md" })).toBe(1);
    expect(out.join("\n")).toContain("Prompt file not found");
  });

  it("refuses empty content", async () => {
    expect(await runAddCommand({ name: "p", content: "   \n" })).toBe(1);
    expect(out.join("\n")).toContain("empty");
  });
});
