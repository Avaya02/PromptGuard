import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findUnknownScopes, runTestCommand } from "./test-command.js";

let cwd: string;
let originalCwd: string;
let errors: string[];

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "diditbreak-test-cmd-"));
  process.chdir(cwd);

  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  delete process.env.DIDITBREAK_API_URL;
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
    join(cwd, "diditbreak.config.ts"),
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
  await mkdir(join(cwd, ".diditbreak"), { recursive: true });
  await writeFile(
    join(cwd, ".diditbreak", "prompts.json"),
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
  // Setup errors exit 2, distinct from 1 (a regression), so CI can tell a
  // failed check from a broken job.
  it("returns 2 and prints a hint when config is missing", async () => {
    expect(await runTestCommand({})).toBe(2);
    expect(errors.join("\n")).toContain("diditbreak init");
  });

  it("returns 2 and points at `diditbreak add` when the registry is empty", async () => {
    await scaffold();
    await writeFile(join(cwd, ".diditbreak", "prompts.json"), '{"prompts":[]}', "utf-8");

    expect(await runTestCommand({})).toBe(2);
    expect(errors.join("\n")).toContain("diditbreak add");
  });

  it("returns 2 and prints a hint when the tests directory is missing", async () => {
    await scaffold();
    await rm(join(cwd, "prompt_tests"), { recursive: true, force: true });

    expect(await runTestCommand({})).toBe(2);
    expect(errors.join("\n")).toContain("diditbreak init");
  });
});

describe("runTestCommand --json", () => {
  let stdout: string[];

  beforeEach(() => {
    stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  it("writes a parseable report and nothing human-formatted", async () => {
    await scaffold();

    expect(await runTestCommand({ json: true })).toBe(0);

    const report = JSON.parse(stdout.join(""));
    expect(report.schemaVersion).toBe(1);
    expect(report.pass).toBe(true);
    expect(report.summary.cases).toBe(1);
  });

  it("reports a failing run with pass false and exit 1", async () => {
    await scaffold({ threshold: 0, cases: [{ input: "x", assert: { contains: "NOPE" } }] });

    expect(await runTestCommand({ json: true })).toBe(1);
    expect(JSON.parse(stdout.join("")).pass).toBe(false);
  });

  it("reports setup errors as JSON too", async () => {
    expect(await runTestCommand({ json: true })).toBe(2);

    const report = JSON.parse(stdout.join(""));
    expect(report.pass).toBe(false);
    expect(report.error.message).toContain("diditbreak.config.ts");
    expect(report.error.hint).toContain("diditbreak init");
  });
});

describe("runTestCommand scoping", () => {
  it("runs a scoped case only against its prompt", async () => {
    await scaffold({
      threshold: 0,
      prompts: [
        { name: "sql", content: "Write SQL." },
        { name: "support", content: "Be kind." }
      ],
      // Would fail against every prompt; scoping must keep it off "support".
      cases: [{ input: "x", assert: { contains: "NOPE" }, prompts: ["sql"] }]
    });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });

    expect(await runTestCommand({ json: true })).toBe(1);

    const report = JSON.parse(stdout.join(""));
    expect(report.prompts.map((p: { promptName: string }) => p.promptName)).toEqual(["sql"]);
  });
});

describe("findUnknownScopes", () => {
  it("lists scope names with no registered prompt", () => {
    const now = new Date().toISOString();
    const registered = [{ name: "a", content: "c", hash: "h", version: 1, createdAt: now, updatedAt: now }];

    expect(
      findUnknownScopes(
        [
          { name: "1", input: "i", expect: "r", prompts: ["a", "typo"] },
          { name: "2", input: "i", expect: "r", prompts: ["ghost"] },
          { name: "3", input: "i", expect: "r" }
        ],
        registered
      )
    ).toEqual(["ghost", "typo"]);
  });
});
