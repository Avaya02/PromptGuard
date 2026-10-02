import type { PromptEvaluationResult } from "@diditbreak/evaluator";

export interface RunSummaryStats {
  prompts: number;
  promptsFailed: number;
  cases: number;
  casesFailed: number;
  /** Cases decided by local assertions, with no model call. */
  deterministic: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  pass: boolean;
}

export function summarize(results: PromptEvaluationResult[]): RunSummaryStats {
  const cases = results.flatMap((result) => result.results);

  return {
    prompts: results.length,
    promptsFailed: results.filter((result) => !result.pass).length,
    cases: cases.length,
    casesFailed: cases.filter((item) => !item.pass).length,
    deterministic: cases.filter((item) => item.assertionType === "deterministic").length,
    tokensUsed: cases.reduce((total, item) => total + item.tokensUsed, 0),
    estimatedCostUsd: cases.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0),
    pass: results.every((result) => result.pass)
  };
}
