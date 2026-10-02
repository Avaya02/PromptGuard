import type { JudgeResult } from "@diditbreak/shared-types";
import type { LLMProvider } from "@diditbreak/llm-provider";
import { describe, expect, it, vi } from "vitest";

import { runEvaluation } from "./run-evaluation.js";
import type { EvaluationTestCase } from "./types.js";

function provider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    generate: vi.fn(async () => "generated"),
    judge: vi.fn(async (): Promise<JudgeResult> => ({ pass: true, reason: "ok", drift: 0 })),
    ...overrides
  };
}

function testCase(name: string, extra: Partial<EvaluationTestCase> = {}): EvaluationTestCase {
  return { name, input: `input-${name}`, expect: null, ...extra };
}

describe("runEvaluation", () => {
  describe("drift scoring", () => {
    it("is 0 when every case passes", async () => {
      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0.1,
        testCases: [testCase("a", { expect: "r" }), testCase("b", { expect: "r" })],
        generationProvider: provider(),
        judgeProvider: provider()
      });

      expect(result.driftScore).toBe(0);
      expect(result.pass).toBe(true);
      expect(result.failedTests).toBe(0);
      expect(result.totalTests).toBe(2);
    });

    it("is the failing fraction of cases", async () => {
      let call = 0;
      const judge = provider({
        judge: vi.fn(async (): Promise<JudgeResult> => {
          call += 1;
          return call === 1
            ? { pass: false, reason: "bad", drift: 1 }
            : { pass: true, reason: "ok", drift: 0 };
        })
      });

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0.9,
        testCases: [
          testCase("a", { expect: "r" }),
          testCase("b", { expect: "r" }),
          testCase("c", { expect: "r" }),
          testCase("d", { expect: "r" })
        ],
        generationProvider: provider(),
        judgeProvider: judge
      });

      expect(result.failedTests).toBe(1);
      expect(result.driftScore).toBe(0.25);
    });

    it("treats an empty suite as zero drift", async () => {
      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0,
        testCases: [],
        generationProvider: provider(),
        judgeProvider: provider()
      });

      expect(result.driftScore).toBe(0);
      expect(result.pass).toBe(true);
    });
  });

  describe("threshold boundaries", () => {
    it("passes when drift exactly equals the threshold", async () => {
      let call = 0;
      const judge = provider({
        judge: vi.fn(async (): Promise<JudgeResult> => {
          call += 1;
          return call === 1
            ? { pass: false, reason: "x", drift: 1 }
            : { pass: true, reason: "ok", drift: 0 };
        })
      });

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0.5,
        concurrency: 1,
        testCases: [testCase("a", { expect: "r" }), testCase("b", { expect: "r" })],
        generationProvider: provider(),
        judgeProvider: judge
      });

      // 1 of 2 failed -> drift 0.5, which is <= threshold and so still a pass.
      expect(result.driftScore).toBe(0.5);
      expect(result.pass).toBe(true);
    });

    it("fails once drift exceeds the threshold", async () => {
      const judge = provider({
        judge: vi.fn(async (): Promise<JudgeResult> => ({ pass: false, reason: "x", drift: 1 }))
      });

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0.49,
        testCases: [testCase("a", { expect: "r" }), testCase("b", { expect: "r" })],
        generationProvider: provider(),
        judgeProvider: judge
      });

      expect(result.pass).toBe(false);
    });
  });

  describe("concurrency", () => {
    it("never exceeds the configured limit", async () => {
      let active = 0;
      let peak = 0;

      const generationProvider = provider({
        generate: vi.fn(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return "generated";
        })
      });

      await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 1,
        concurrency: 2,
        testCases: Array.from({ length: 10 }, (_, i) => testCase(`case-${i}`, { expect: "r" })),
        generationProvider,
        judgeProvider: provider()
      });

      expect(peak).toBeLessThanOrEqual(2);
      expect(peak).toBeGreaterThan(1);
    });

    it("serialises fully at concurrency 1", async () => {
      let active = 0;
      let peak = 0;

      const generationProvider = provider({
        generate: vi.fn(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return "generated";
        })
      });

      await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 1,
        concurrency: 1,
        testCases: Array.from({ length: 5 }, (_, i) => testCase(`case-${i}`, { expect: "r" })),
        generationProvider,
        judgeProvider: provider()
      });

      expect(peak).toBe(1);
    });

    it("evaluates every case regardless of the limit", async () => {
      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 1,
        concurrency: 3,
        testCases: Array.from({ length: 7 }, (_, i) => testCase(`case-${i}`, { expect: "r" })),
        generationProvider: provider(),
        judgeProvider: provider()
      });

      expect(result.totalTests).toBe(7);
      expect(result.results).toHaveLength(7);
    });
  });

  describe("deterministic short-circuiting", () => {
    it("never calls the judge when an assertion fails", async () => {
      const judgeProvider = provider();

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 1,
        testCases: [
          testCase("a", { expect: "some rubric", assert: { contains: "MISSING" } })
        ],
        generationProvider: provider({ generate: vi.fn(async () => "output without it") }),
        judgeProvider
      });

      expect(judgeProvider.judge).not.toHaveBeenCalled();
      expect(result.results[0]?.pass).toBe(false);
      expect(result.results[0]?.assertionType).toBe("deterministic");
      expect(result.results[0]?.tokensUsed).toBe(0);
    });

    it("skips the judge entirely for deterministic-only cases that pass", async () => {
      const judgeProvider = provider();

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0,
        testCases: [testCase("a", { expect: null, assert: { contains: "generated" } })],
        generationProvider: provider(),
        judgeProvider
      });

      expect(judgeProvider.judge).not.toHaveBeenCalled();
      expect(result.results[0]?.pass).toBe(true);
      expect(result.results[0]?.assertionType).toBe("deterministic");
      expect(result.pass).toBe(true);
    });

    it("proceeds to the judge when assertions pass and a rubric is set", async () => {
      const judgeProvider = provider();

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 0,
        testCases: [
          testCase("a", { expect: "must be polite", assert: { contains: "generated" } })
        ],
        generationProvider: provider(),
        judgeProvider
      });

      expect(judgeProvider.judge).toHaveBeenCalledTimes(1);
      expect(result.results[0]?.assertionType).toBe("semantic");
    });
  });

  describe("failure isolation", () => {
    it("records a provider throw as a failed case without aborting the run", async () => {
      let call = 0;
      const generationProvider = provider({
        generate: vi.fn(async () => {
          call += 1;
          if (call === 1) {
            throw new Error("upstream exploded");
          }
          return "generated";
        })
      });

      const result = await runEvaluation({
        promptName: "p",
        versionB: "prompt",
        threshold: 1,
        concurrency: 1,
        testCases: [testCase("a", { expect: "r" }), testCase("b", { expect: "r" })],
        generationProvider,
        judgeProvider: provider()
      });

      expect(result.totalTests).toBe(2);
      expect(result.results[0]?.pass).toBe(false);
      expect(result.results[0]?.reason).toContain("upstream exploded");
      expect(result.results[1]?.pass).toBe(true);
    });
  });
});
