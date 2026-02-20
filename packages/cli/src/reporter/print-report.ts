import chalk from "chalk";

import type { PromptEvaluationResult } from "@promptguard/evaluator";

interface PrintReportInput {
  threshold: number;
  results: PromptEvaluationResult[];
}

export function printReport(input: PrintReportInput): void {
  const caseRows = input.results.flatMap((promptResult) =>
    promptResult.results.map((testResult) => ({
      prompt: promptResult.promptName,
      test: testResult.testName,
      pass: testResult.pass ? "PASS" : "FAIL",
      drift: testResult.driftScore.toFixed(3),
      latencyMs: testResult.latencyMs,
      tokens: testResult.tokensUsed,
      reason: testResult.reason
    }))
  );

  const summaryRows = input.results.map((promptResult) => ({
    prompt: promptResult.promptName,
    pass: promptResult.pass ? "PASS" : "FAIL",
    driftScore: promptResult.driftScore.toFixed(3),
    failed: `${promptResult.failedTests}/${promptResult.totalTests}`
  }));

  const failedPrompts = input.results.filter((result) => !result.pass).length;
  const overallPass = failedPrompts === 0;

  console.log("\nTest Results");
  console.table(caseRows);

  console.log("Summary");
  console.table(summaryRows);

  const totalFailed = input.results.reduce((total, result) => total + result.failedTests, 0);
  const totalTests = input.results.reduce((total, result) => total + result.totalTests, 0);
  const overallDrift = totalTests === 0 ? 0 : totalFailed / totalTests;

  const status = overallPass ? chalk.green("PASS") : chalk.red("FAIL");
  console.log(
    `${status} overall drift ${overallDrift.toFixed(3)} (threshold ${input.threshold.toFixed(3)})`
  );
}
