import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../errors.js";
import { loadTestCases } from "./load-test-cases.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "diditbreak-cli-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function writeTests(name: string, body: unknown): Promise<void> {
  await mkdir(join(cwd, "prompt_tests"), { recursive: true });
  await writeFile(join(cwd, "prompt_tests", name), JSON.stringify(body), "utf-8");
}

describe("loadTestCases", () => {
  describe("missing directories", () => {
    it("raises an actionable error instead of a raw ENOENT", async () => {
      const error = await loadTestCases(cwd, "prompt_tests").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("Test directory not found");
      expect((error as CliError).hint).toContain("diditbreak init");
    });

    it("raises an actionable error for an empty directory", async () => {
      await mkdir(join(cwd, "prompt_tests"), { recursive: true });

      const error = await loadTestCases(cwd, "prompt_tests").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("No .json test files");
    });

    it("ignores non-json files", async () => {
      await mkdir(join(cwd, "prompt_tests"), { recursive: true });
      await writeFile(join(cwd, "prompt_tests", "notes.md"), "# notes", "utf-8");

      await expect(loadTestCases(cwd, "prompt_tests")).rejects.toThrow(/No .json test files/);
    });
  });

  describe("parsing", () => {
    it("loads semantic cases and names them by file and index", async () => {
      await writeTests("a.json", {
        cases: [
          { input: "one", expect: "rubric one" },
          { input: "two", expect: "rubric two" }
        ]
      });

      const cases = await loadTestCases(cwd, "prompt_tests");
      expect(cases).toHaveLength(2);
      expect(cases[0]?.name).toBe("a.json#1");
      expect(cases[1]?.name).toBe("a.json#2");
    });

    it("loads deterministic-only cases", async () => {
      await writeTests("a.json", {
        cases: [{ input: "one", assert: { contains: "hello", max_latency_ms: 500 } }]
      });

      const cases = await loadTestCases(cwd, "prompt_tests");
      expect(cases[0]?.expect).toBeNull();
      expect(cases[0]?.assert).toEqual({ contains: "hello", max_latency_ms: 500 });
    });

    it("loads a case carrying both assert and expect", async () => {
      await writeTests("a.json", {
        cases: [{ input: "one", expect: "be polite", assert: { not_contains: "idiot" } }]
      });

      const cases = await loadTestCases(cwd, "prompt_tests");
      expect(cases[0]?.expect).toBe("be polite");
      expect(cases[0]?.assert).toEqual({ not_contains: "idiot" });
    });

    it("reads files in a stable sorted order", async () => {
      await writeTests("b.json", { cases: [{ input: "b", expect: "r" }] });
      await writeTests("a.json", { cases: [{ input: "a", expect: "r" }] });

      const cases = await loadTestCases(cwd, "prompt_tests");
      expect(cases.map((c) => c.name)).toEqual(["a.json#1", "b.json#1"]);
    });

    it("rejects a case with neither expect nor assert", async () => {
      await writeTests("a.json", { cases: [{ input: "orphan" }] });

      const error = await loadTestCases(cwd, "prompt_tests").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).hint).toContain("expect");
    });

    it("reports the offending file on malformed JSON", async () => {
      await mkdir(join(cwd, "prompt_tests"), { recursive: true });
      await writeFile(join(cwd, "prompt_tests", "broken.json"), "{not json", "utf-8");

      const error = await loadTestCases(cwd, "prompt_tests").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("broken.json");
    });

    it("rejects an unknown assert key", async () => {
      await writeTests("a.json", { cases: [{ input: "x", assert: { contain: "typo" } }] });

      // Strict schema: a typo'd check must fail loudly rather than pass vacuously.
      await expect(loadTestCases(cwd, "prompt_tests")).rejects.toThrow(CliError);
    });

    it("uses a case's own name when given", async () => {
      await writeTests("a.json", { cases: [{ name: "refund-flow", input: "x", expect: "y" }] });
      expect((await loadTestCases(cwd, "prompt_tests"))[0]?.name).toBe("refund-flow");
    });

    it("applies a file-level prompt scope to every case", async () => {
      await writeTests("a.json", {
        prompts: "sql",
        cases: [
          { input: "one", expect: "r" },
          { input: "two", expect: "r" }
        ]
      });

      const cases = await loadTestCases(cwd, "prompt_tests");
      expect(cases.map((c) => c.prompts)).toEqual([["sql"], ["sql"]]);
    });

    it("lets a case override the file scope", async () => {
      await writeTests("a.json", {
        prompts: ["sql"],
        cases: [{ input: "one", expect: "r", prompts: ["support", "sql"] }]
      });

      expect((await loadTestCases(cwd, "prompt_tests"))[0]?.prompts).toEqual(["support", "sql"]);
    });

    it("leaves cases unscoped when no scope is given", async () => {
      await writeTests("a.json", { cases: [{ input: "one", expect: "r" }] });
      expect((await loadTestCases(cwd, "prompt_tests"))[0]?.prompts).toBeUndefined();
    });

    it("rejects an empty cases array", async () => {
      await writeTests("a.json", { cases: [] });
      await expect(loadTestCases(cwd, "prompt_tests")).rejects.toThrow(CliError);
    });
  });
});
