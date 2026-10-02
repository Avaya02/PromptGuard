import type { PromptEvaluationResult } from "@diditbreak/evaluator";
import chalk from "chalk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildJsonReport } from "./json-report.js";
import { printReport } from "./print-report.js";
import { summarize } from "./summarize.js";

// Assert on text, not escape codes.
const originalLevel = chalk.level;
beforeAll(() => {
  chalk.level = 0;
});
afterAll(() => {
  chalk.level = originalLevel;
});

function caseResult(overrides: Record<string, unknown> = {}) {
  return {
    testName: "case-1",
    pass: true,
    driftScore: 0,
    reason: "ok",
    latencyMs: 10,
    tokensUsed: 0,
    assertionType: "deterministic" as const,
    ...overrides
  };
}

function prompt(overrides: Partial<PromptEvaluationResult> = {}): PromptEvaluationResult {
  return {
    promptName: "prompt-a",
    pass: true,
    driftScore: 0,
    failedTests: 0,
    totalTests: 1,
    results: [caseResult()],
    ...overrides
  };
}

function render(input: Parameters<typeof printReport>[0]): string {
  const lines: string[] = [];
  printReport({ ...input, write: (line) => lines.push(line) });
  return lines.join("\n");
}

describe("printReport", () => {
  it("groups cases under their prompt with a pass mark", () => {
    const output = render({ threshold: 0.1, results: [prompt()] });

    expect(output).toContain(" prompt-a");
    expect(output).toMatch(/✓ case-1\s+assert/);
  });

  it("prints the failure reason under a failing case", () => {
    const output = render({
      threshold: 0,
      results: [
        prompt({
          pass: false,
          driftScore: 1,
          failedTests: 1,
          results: [caseResult({ pass: false, reason: "regex: output did not match /^SELECT/" })]
        })
      ]
    });

    expect(output).toMatch(/✗ case-1/);
    expect(output).toContain("└ regex: output did not match /^SELECT/");
  });

  it("does not print reasons for passing cases", () => {
    const output = render({ threshold: 0.1, results: [prompt()] });
    expect(output).not.toContain("└");
  });

  it("labels judge-decided cases distinctly from assertions", () => {
    const output = render({
      threshold: 0.1,
      results: [prompt({ results: [caseResult({ assertionType: "semantic" })] })]
    });

    expect(output).toMatch(/case-1\s+judge/);
  });

  it("shows each prompt's drift against the threshold", () => {
    const output = render({
      threshold: 0.25,
      results: [
        prompt({ promptName: "good" }),
        prompt({ promptName: "bad", pass: false, driftScore: 0.5, failedTests: 1 })
      ]
    });

    // Names are padded to a common width so the drift column lines up.
    expect(output).toContain("✓ good  drift 0.000 ≤ 0.250");
    expect(output).toContain("✗ bad   drift 0.500 > 0.250  regressed");
  });

  it("reports PASS when every prompt passes", () => {
    expect(render({ threshold: 0.1, results: [prompt()] })).toMatch(/Result\s+PASS/);
  });

  it("reports FAIL with the number of regressed prompts", () => {
    const output = render({
      threshold: 0,
      results: [prompt({ promptName: "a" }), prompt({ promptName: "b", pass: false })]
    });

    expect(output).toContain("FAIL 1 of 2 prompts regressed");
  });

  it("summarises cases, zero-cost checks, tokens and cost", () => {
    const output = render({
      threshold: 1,
      results: [
        prompt({
          results: [
            caseResult(),
            caseResult({ testName: "c2", pass: false, assertionType: "semantic", tokensUsed: 1200, estimatedCostUsd: 0.0005 })
          ]
        })
      ]
    });

    expect(output).toContain("1 passed, 1 failed");
    expect(output).toContain("1 zero-cost");
    expect(output).toContain("1,200 tokens");
    expect(output).toContain("$0.0005");
  });

  it("formats the run duration", () => {
    expect(render({ threshold: 0.1, results: [prompt()], durationMs: 850 })).toContain("(850ms)");
    expect(render({ threshold: 0.1, results: [prompt()], durationMs: 2345 })).toContain("(2.35s)");
  });

  it("truncates very long case names instead of breaking alignment", () => {
    const output = render({
      threshold: 0.1,
      results: [prompt({ results: [caseResult({ testName: "x".repeat(80) })] })]
    });

    expect(output).toContain("…");
    expect(output).not.toContain("x".repeat(80));
  });

  it("handles an empty result set", () => {
    const output = render({ threshold: 0.1, results: [] });
    expect(output).toMatch(/Result\s+PASS/);
    expect(output).toContain("0 passed");
  });

  it("prints plain PASS/FAIL without padding when colour is off", () => {
    // Padded badges only read as badges on a coloured background.
    expect(render({ threshold: 0.1, results: [prompt()] })).toMatch(/Result {2}PASS$/m);
  });
});

describe("summarize", () => {
  it("aggregates across prompts", () => {
    const stats = summarize([
      prompt({ results: [caseResult(), caseResult({ assertionType: "semantic", tokensUsed: 50 })] }),
      prompt({ pass: false, results: [caseResult({ pass: false, estimatedCostUsd: 0.25 })] })
    ]);

    expect(stats).toEqual({
      prompts: 2,
      promptsFailed: 1,
      cases: 3,
      casesFailed: 1,
      deterministic: 2,
      tokensUsed: 50,
      estimatedCostUsd: 0.25,
      pass: false
    });
  });
});

describe("buildJsonReport", () => {
  it("produces a versioned, self-describing report", () => {
    const report = buildJsonReport({ threshold: 0.1, results: [prompt()], durationMs: 42 });

    expect(report.schemaVersion).toBe(1);
    expect(report.pass).toBe(true);
    expect(report.threshold).toBe(0.1);
    expect(report.durationMs).toBe(42);
    expect(report.summary.cases).toBe(1);
    expect(report.prompts[0]?.promptName).toBe("prompt-a");
  });

  it("round-trips through JSON", () => {
    const report = buildJsonReport({ threshold: 0.1, results: [prompt()] });
    expect(JSON.parse(JSON.stringify(report))).toEqual({ ...report, durationMs: null });
  });
});
