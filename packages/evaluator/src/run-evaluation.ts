import type { PromptEvaluationResult, RunEvaluationInput } from "./types.js";
import { evaluateCase } from "./runner/evaluate-case.js";

export async function runEvaluation(input: RunEvaluationInput): Promise<PromptEvaluationResult> {
  const results = await Promise.all(
    input.testCases.map(async (testCase, index) =>
      evaluateCase({
        index,
        testCase,
        versionB: input.versionB,
        generationProvider: input.generationProvider,
        judgeProvider: input.judgeProvider,
        ...(input.versionA !== undefined ? { versionA: input.versionA } : {})
      })
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
