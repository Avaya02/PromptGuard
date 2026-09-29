import pLimit from "p-limit";

import type { PromptEvaluationResult, RunEvaluationInput } from "./types.js";
import { evaluateCase } from "./runner/evaluate-case.js";

export const DEFAULT_CONCURRENCY = 5;

export async function runEvaluation(input: RunEvaluationInput): Promise<PromptEvaluationResult> {
  // Unbounded fan-out trips provider rate limits (HTTP 429) and saturates local
  // Ollama, so cases run through a bounded pool.
  const concurrency =
    input.concurrency !== undefined && input.concurrency > 0
      ? Math.floor(input.concurrency)
      : DEFAULT_CONCURRENCY;

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    input.testCases.map(async (testCase, index) =>
      limit(async () =>
        evaluateCase({
          index,
          testCase,
          versionB: input.versionB,
          generationProvider: input.generationProvider,
          judgeProvider: input.judgeProvider,
          ...(input.versionA !== undefined ? { versionA: input.versionA } : {})
        })
      )
    )
  );

  const failedTests = results.filter((result) => !result.pass).length;
  const totalTests = results.length;
  const driftScore = totalTests === 0 ? 0 : failedTests / totalTests;

  return {
    promptName: input.promptName,
    pass: driftScore <= input.threshold,
    driftScore,
    failedTests,
    totalTests,
    results
  };
}
