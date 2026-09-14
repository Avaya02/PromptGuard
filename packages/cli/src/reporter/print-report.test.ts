import type { PromptEvaluationResult } from "@promptguard/evaluator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { printReport } from "./print-report.js";

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "table").mockImplementation((data: unknown) => {
    logged.push(JSON.stringify(data));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function result(overrides: Partial<PromptEvaluationResult> = {}): PromptEvaluationResult {
  return {
    promptName: "prompt-a",
    pass: true,
    driftScore: 0,
    failedTests: 0,
    totalTests: 1,
    results: [
      {
        testName: "case-1",
        pass: true,
        driftScore: 0,
        reason: "ok",
        latencyMs: 10,
        tokensUsed: 5,
        assertionType: "semantic"
      }
    ],
    ...overrides
  };
}

describe("printReport", () => {
  it("reports PASS when every prompt passes", () => {
    printReport({ threshold: 0.1, results: [result()] });

    const output = logged.join("\n");
    expect(output).toContain("PASS");
    expect(output).toContain("overall drift 0.000");
  });

  it("reports FAIL when a prompt regresses", () => {
    printReport({
      threshold: 0.1,
      results: [result({ pass: false, driftScore: 1, failedTests: 1 })]
    });

    expect(logged.join("\n")).toContain("FAIL");
  });

  it("computes overall drift across prompts, not per prompt", () => {
    printReport({
      threshold: 0.5,
      results: [
        result({ promptName: "a", totalTests: 2, failedTests: 0 }),
        result({ promptName: "b", totalTests: 2, failedTests: 2, pass: false, driftScore: 1 })
      ]
    });

    // 2 failures across 4 total cases.
    expect(logged.join("\n")).toContain("overall drift 0.500");
  });

  it("echoes the configured threshold", () => {
    printReport({ threshold: 0.25, results: [result()] });
    expect(logged.join("\n")).toContain("threshold 0.250");
  });

  it("handles an empty result set without dividing by zero", () => {
    printReport({ threshold: 0.1, results: [] });

    const output = logged.join("\n");
    expect(output).toContain("overall drift 0.000");
    expect(output).toContain("PASS");
  });

  it("includes each case row with its metrics", () => {
    printReport({ threshold: 0.1, results: [result()] });

    const output = logged.join("\n");
    expect(output).toContain("case-1");
    expect(output).toContain("prompt-a");
  });
});
