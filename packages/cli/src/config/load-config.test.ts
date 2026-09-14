import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PromptGuardCliError } from "../errors.js";
import { loadConfig } from "./load-config.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "promptguard-config-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function writeConfig(source: string): Promise<void> {
  await writeFile(join(cwd, "promptguard.config.ts"), source, "utf-8");
}

const VALID = `export default {
  threshold: 0.2,
  testsDir: "prompt_tests",
  generationModel: { provider: "mock", model: "mock" },
  judgeModel: { provider: "mock", model: "mock" }
};`;

describe("loadConfig", () => {
  it("parses a valid TypeScript config", async () => {
    await writeConfig(VALID);

    const config = await loadConfig(cwd);
    expect(config.threshold).toBe(0.2);
    expect(config.testsDir).toBe("prompt_tests");
    expect(config.generationModel.provider).toBe("mock");
  });

  it("accepts an optional concurrency", async () => {
    await writeConfig(`export default {
      threshold: 0.1,
      testsDir: "t",
      concurrency: 12,
      generationModel: { provider: "mock", model: "mock" },
      judgeModel: { provider: "mock", model: "mock" }
    };`);

    expect((await loadConfig(cwd)).concurrency).toBe(12);
  });

  it("leaves concurrency undefined when omitted", async () => {
    await writeConfig(VALID);
    expect((await loadConfig(cwd)).concurrency).toBeUndefined();
  });

  it("raises an actionable error when the config is absent", async () => {
    const error = await loadConfig(cwd).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PromptGuardCliError);
    expect((error as PromptGuardCliError).hint).toContain("prompt-guard init");
  });

  describe("validation", () => {
    it("rejects a threshold above 1", async () => {
      await writeConfig(VALID.replace("0.2", "1.5"));
      await expect(loadConfig(cwd)).rejects.toThrow();
    });

    it("rejects a negative threshold", async () => {
      await writeConfig(VALID.replace("0.2", "-0.1"));
      await expect(loadConfig(cwd)).rejects.toThrow();
    });

    it("accepts the boundary values 0 and 1", async () => {
      await writeConfig(VALID.replace("0.2", "0"));
      expect((await loadConfig(cwd)).threshold).toBe(0);

      await writeConfig(VALID.replace("0.2", "1"));
      expect((await loadConfig(cwd)).threshold).toBe(1);
    });

    it("rejects a missing judgeModel", async () => {
      await writeConfig(`export default {
        threshold: 0.1,
        testsDir: "t",
        generationModel: { provider: "mock", model: "mock" }
      };`);

      await expect(loadConfig(cwd)).rejects.toThrow();
    });

    it("rejects a non-url baseUrl", async () => {
      await writeConfig(`export default {
        threshold: 0.1,
        testsDir: "t",
        generationModel: { provider: "local", model: "llama3", baseUrl: "not a url" },
        judgeModel: { provider: "mock", model: "mock" }
      };`);

      await expect(loadConfig(cwd)).rejects.toThrow();
    });

    it("rejects an empty testsDir", async () => {
      await writeConfig(VALID.replace('"prompt_tests"', '""'));
      await expect(loadConfig(cwd)).rejects.toThrow();
    });
  });
});
