import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runTestCommand } from "./test-command.js";

let cwd: string;
let originalCwd: string;
let errors: string[];

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "promptguard-test-cmd-"));
  process.chdir(cwd);

  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  delete process.env.PROMPTGUARD_API_URL;
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function scaffold(options: {
  threshold?: number;
  cases?: unknown[];
  prompts?: Array<{ name: string; content: string }>;
} = {}): Promise<void> {
  await writeFile(
    join(cwd, "promptguard.config.ts"),
    `export default {
      threshold: ${options.threshold ?? 0.1},
      testsDir: "prompt_tests",
      concurrency: 2,
      generationModel: { provider: "mock", model: "mock" },
      judgeModel: { provider: "mock", model: "mock" }
    };`,
    "utf-8"
  );

  await mkdir(join(cwd, "prompt_tests"), { recursive: true });
  await writeFile(
    join(cwd, "prompt_tests", "cases.json"),
    JSON.stringify({
      cases: options.cases ?? [{ input: "hello", assert: { contains: "mock-response" } }]
    }),
    "utf-8"
  );

  const now = new Date().toISOString();
  await mkdir(join(cwd, ".promptguard"), { recursive: true });
  await writeFile(
    join(cwd, ".promptguard", "prompts.json"),
    JSON.stringify({
      prompts: (options.prompts ?? [{ name: "greeter", content: "Say hello." }]).map((p) => ({
        ...p,
        hash: "a".repeat(64),
        version: 1,
        createdAt: now,
        updatedAt: now
      }))
    }),
    "utf-8"
  );
}

describe("runTestCommand exit codes", () => {
  it("returns 0 when every case passes", async () => {
    await scaffold();
    expect(await runTestCommand({})).toBe(0);
  });

  it("returns 1 when a deterministic assertion fails", async () => {
    await scaffold({
      threshold: 0,
      cases: [{ input: "hello", assert: { contains: "WILL_NOT_MATCH" } }]
    });

    expect(await runTestCommand({})).toBe(1);
  });

  it("returns 0 when failures stay within the threshold", async () => {
    await scaffold({
      threshold: 0.5,
      cases: [
        { input: "a", assert: { contains: "mock-response" } },
        { input: "b", assert: { contains: "WILL_NOT_MATCH" } }
      ]
    });

    // 1 of 2 failing is drift 0.5, exactly at the threshold, so it passes.
    expect(await runTestCommand({})).toBe(0);
  });

  it("returns 1 when failures exceed the threshold", async () => {
    await scaffold({
      threshold: 0.4,
      cases: [
        { input: "a", assert: { contains: "mock-response" } },
        { input: "b", assert: { contains: "WILL_NOT_MATCH" } }
      ]
    });

    expect(await runTestCommand({})).toBe(1);
  });

  it("fails if any prompt regresses, even when others pass", async () => {
    await scaffold({
      threshold: 0,
      cases: [{ input: "a", assert: { contains: "WILL_NOT_MATCH" } }],
      prompts: [
        { name: "a", content: "Prompt A" },
        { name: "b", content: "Prompt B" }
      ]
    });

    expect(await runTestCommand({})).toBe(1);
  });
});

describe("runTestCommand error handling", () => {
  it("returns 1 and prints a hint when config is missing", async () => {
    expect(await runTestCommand({})).toBe(1);
    expect(errors.join("\n")).toContain("prompt-guard init");
  });

  it("returns 1 and prints a hint when the registry is empty", async () => {
    await scaffold();
    await writeFile(join(cwd, ".promptguard", "prompts.json"), '{"prompts":[]}', "utf-8");

    expect(await runTestCommand({})).toBe(1);
    expect(errors.join("\n")).toContain("definePrompt");
  });

  it("returns 1 and prints a hint when the tests directory is missing", async () => {
    await scaffold();
    await rm(join(cwd, "prompt_tests"), { recursive: true, force: true });

    expect(await runTestCommand({})).toBe(1);
    expect(errors.join("\n")).toContain("prompt-guard init");
  });
});
