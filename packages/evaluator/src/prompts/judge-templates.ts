import type { EvaluationTestCase } from "../types.js";

export function toJudgeCase(testCase: EvaluationTestCase): EvaluationTestCase {
  if (testCase.expect !== null) {
    return {
      ...testCase,
      expect: [
        `Evaluate Response B against the following rubric: ${testCase.expect}.`,
        "Does it satisfy the criteria without degradation?",
        "Return JSON: {pass: boolean, reason: string, drift: number}"
      ].join("\n")
    };
  }

  return {
    ...testCase,
    expect: null
  };
}
