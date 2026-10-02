import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkNode, runDoctorChecks, type CheckResult, type DoctorEnvironment } from "./doctor-command.js";
import { runInitCommand } from "./init-command.js";

const run = promisify(execFile);
let cwd: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  cwd = await mkdtemp(join(tmpdir(), "diditbreak-doctor-"));
  process.chdir(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function environment(overrides: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    cwd,
    env: {},
    nodeVersion: "v22.1.0",
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    ...overrides
  };
}

function find(results: CheckResult[], label: string): CheckResult | undefined {
  return results.find((result) => result.label === label);
}

async function gitInit(): Promise<void> {
  await run("git", ["init", "-q"], { cwd });
  await run("git", ["config", "user.email", "t@example.com"], { cwd });
  await run("git", ["config", "user.name", "T"], { cwd });
}

describe("checkNode", () => {
  it("accepts a supported version", () => {
    expect(checkNode("v20.11.0").status).toBe("ok");
    expect(checkNode("v24.0.0").status).toBe("ok");
  });

  it("fails an old version with a fix", () => {
    const result = checkNode("v18.19.0");
    expect(result.status).toBe("fail");
    expect(result.fix).toContain("Node 20");
  });
});

describe("runDoctorChecks", () => {
  it("passes a freshly initialised, committed project", async () => {
    await gitInit();
    await runInitCommand({ prompts: true });
    await run("git", ["add", "-A"], { cwd });
    await run("git", ["commit", "-q", "-m", "init"], { cwd });

    const results = await runDoctorChecks(environment());

    expect(results.filter((r) => r.status === "fail" || r.status === "warn")).toEqual([]);
    expect(find(results, "Prompts")?.detail).toContain("support-agent");
    expect(find(results, "Tests")?.detail).toContain("2 cases in 1 file");
  });

  it("fails the config check with the init hint when nothing exists", async () => {
    const results = await runDoctorChecks(environment());

    const config = find(results, "Config");
    expect(config?.status).toBe("fail");
    expect(config?.fix).toContain("diditbreak init");
    // Model checks depend on the config, so they are skipped, not failed.
    expect(find(results, "Models")?.status).toBe("skip");
  });

  it("warns when the registry is not committed", async () => {
    await gitInit();
    await runInitCommand({ prompts: true });

    const baseline = find(await runDoctorChecks(environment()), "Baseline");
    expect(baseline?.status).toBe("warn");
    expect(baseline?.fix).toContain("git add .diditbreak/prompts.json");
  });

  it("fails when the registry is gitignored", async () => {
    await gitInit();
    await runInitCommand({ prompts: true });
    await writeFile(join(cwd, ".gitignore"), ".diditbreak\n", "utf-8");

    // The silent failure this check exists to catch: --base would compare
    // against nothing without any error.
    const baseline = find(await runDoctorChecks(environment()), "Baseline");
    expect(baseline?.status).toBe("fail");
    expect(baseline?.detail).toContain("gitignored");
  });

  it("warns outside a git repository", async () => {
    await runInitCommand({ prompts: true });
    expect(find(await runDoctorChecks(environment()), "Baseline")?.status).toBe("warn");
  });

  it("fails a hosted provider whose key is missing, naming the variable", async () => {
    await runInitCommand({ prompts: true, provider: "groq" });

    const results = await runDoctorChecks(environment());
    const generation = find(results, "Generation model");
    expect(generation?.status).toBe("fail");
    expect(generation?.detail).toContain("GROQ_API_KEY");
  });

  it("passes a hosted provider once its key is set", async () => {
    await runInitCommand({ prompts: true, provider: "anthropic" });

    const results = await runDoctorChecks(environment({ env: { ANTHROPIC_API_KEY: "k" } }));
    expect(find(results, "Judge model")?.status).toBe("ok");
  });

  it("accepts a keyless OpenAI-compatible server", async () => {
    await runInitCommand({ prompts: true });
    await writeFile(
      join(cwd, "diditbreak.config.ts"),
      `export default {
        threshold: 0.1,
        testsDir: "prompt_tests",
        generationModel: { provider: "openai", model: "llama-3", baseUrl: "http://localhost:8000" },
        judgeModel: { provider: "mock", model: "mock" }
      };`,
      "utf-8"
    );

    const generation = find(await runDoctorChecks(environment()), "Generation model");
    expect(generation?.status).toBe("ok");
    expect(generation?.detail).toContain("OpenAI-compatible");
  });

  it("checks that Ollama is reachable for local models", async () => {
    await runInitCommand({ prompts: true, provider: "ollama" });

    const down = await runDoctorChecks(
      environment({ fetch: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch })
    );
    expect(find(down, "Generation model")?.fix).toContain("ollama serve");

    const up = await runDoctorChecks(environment());
    expect(find(up, "Generation model")?.status).toBe("ok");
  });

  it("warns about test files targeting unregistered prompts", async () => {
    await runInitCommand({ prompts: true });
    await writeFile(
      join(cwd, "prompt_tests/extra.json"),
      JSON.stringify({ prompts: ["sql-gen"], cases: [{ input: "x", expect: "y" }] }),
      "utf-8"
    );

    const results = await runDoctorChecks(environment());
    const warning = results.find((r) => r.label === "Tests" && r.status === "warn");
    expect(warning?.detail).toContain("sql-gen");
  });

  it("skips the remote API check when no URL is configured", async () => {
    expect(find(await runDoctorChecks(environment()), "Remote API")?.status).toBe("skip");
  });

  it("reports a healthy remote API", async () => {
    const results = await runDoctorChecks(
      environment({ env: { DIDITBREAK_API_URL: "http://api.test" } })
    );
    expect(find(results, "Remote API")?.status).toBe("ok");
  });

  it("reports a degraded remote API with its component states", async () => {
    const results = await runDoctorChecks(
      environment({
        env: { DIDITBREAK_API_URL: "http://api.test/" },
        fetch: vi.fn(async () =>
          new Response(JSON.stringify({ db: "connected", redis: "disconnected" }), { status: 503 })
        ) as unknown as typeof fetch
      })
    );

    expect(find(results, "Remote API")?.detail).toContain("redis: disconnected");
  });
});
